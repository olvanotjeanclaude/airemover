import { describe, expect, it } from "vitest";
import { detectAiFromSource, detectAiMetadata } from "../parser/ai";
import { detectProvenanceGenerator } from "../parser/ai/provenance";
import { containsAiSignature } from "../parser/ai/signals";
import { parseSettingsPairs, splitSettingsLine } from "../parser/ai/settings-line";
import type { AiTextSource } from "../parser/ai/types";
import { A1111_PARAMETERS, COMFY_PROMPT, NOVELAI_COMMENT } from "./fixtures";

function source(key: string, text: string): AiTextSource {
  return { origin: `test:${key}`, key, text, bytes: text.length };
}

describe("settings-line tokeniser", () => {
  it("does not split on commas inside quotes or braces", () => {
    const line = 'Steps: 20, Lora hashes: "a: 1, b: 2", Hashes: {"model":"x,y"}, Seed: 5';
    expect(splitSettingsLine(line)).toEqual([
      "Steps: 20",
      'Lora hashes: "a: 1, b: 2"',
      'Hashes: {"model":"x,y"}',
      "Seed: 5",
    ]);
  });

  it("splits each token on its first colon only", () => {
    const pairs = parseSettingsPairs("Model: v1-5, Version: v1.9.4, Size: 512x768");
    expect(pairs.get("model")).toBe("v1-5");
    expect(pairs.get("version")).toBe("v1.9.4");
    expect(pairs.get("size")).toBe("512x768");
  });
});

describe("Automatic1111", () => {
  it("splits prompt, negative prompt and settings", () => {
    const result = detectAiFromSource(source("parameters", A1111_PARAMETERS));

    expect(result?.generator).toBe("automatic1111");
    expect(result?.confidence).toBe("confirmed");
    expect(result?.prompt).toBe(
      "a photograph of a snow leopard on a rock, cinematic lighting",
    );
    expect(result?.negativePrompt).toBe("blurry, lowres, watermark");
    expect(result?.steps).toBe("32");
    expect(result?.sampler).toBe("DPM++ 2M Karras");
    expect(result?.cfgScale).toBe("7.5");
    expect(result?.seed).toBe("284819251");
    expect(result?.size).toBe("768x1152");
    expect(result?.model).toBe("v1-5-pruned-emaonly");
    expect(result?.checkpoint).toBe("6ce0161689");
    expect(result?.clipSkip).toBe("2");
    expect(result?.loras).toEqual(["detail_slider"]);
  });

  it("handles a multi-line prompt with no negative prompt", () => {
    const text = [
      "line one of the prompt",
      "line two of the prompt",
      "Steps: 20, Sampler: Euler a, CFG scale: 7, Seed: 1",
    ].join("\n");
    const result = detectAiFromSource(source("parameters", text));

    expect(result?.prompt).toBe("line one of the prompt\nline two of the prompt");
    expect(result?.negativePrompt).toBeUndefined();
  });

  it("recognises a Flux checkpoint and relabels the generator", () => {
    const text = "a castle\nNegative prompt: \nSteps: 20, Sampler: Euler, Model: flux1-dev, Seed: 9";
    expect(detectAiFromSource(source("parameters", text))?.generator).toBe("flux");
  });

  it("ignores prose that merely contains a colon", () => {
    expect(detectAiFromSource(source("Description", "Sunset: a study in orange"))).toBeNull();
  });

  it("extracts inline LoRA tags from the prompt itself", () => {
    const text = "a knight <lora:armor_style:0.8>\nNegative prompt: blur\nSteps: 20, Sampler: Euler, Seed: 3";
    expect(detectAiFromSource(source("parameters", text))?.loras).toEqual(["armor_style"]);
  });
});

describe("ComfyUI", () => {
  it("follows the sampler links to the positive and negative encoders", () => {
    const result = detectAiFromSource(source("prompt", COMFY_PROMPT));

    expect(result?.generator).toBe("comfyui");
    expect(result?.prompt).toBe("a red fox in the snow");
    expect(result?.negativePrompt).toBe("text, watermark");
    expect(result?.steps).toBe("25");
    expect(result?.cfgScale).toBe("8");
    expect(result?.sampler).toBe("euler");
    expect(result?.scheduler).toBe("normal");
    expect(result?.model).toBe("sd_xl_base_1.0.safetensors");
    expect(result?.size).toBe("1024x1024");
  });

  it("reads the positional UI workflow format", () => {
    const workflow = JSON.stringify({
      nodes: [
        { id: 1, type: "CLIPTextEncode", widgets_values: ["a lighthouse at dusk"] },
        {
          id: 2,
          type: "KSampler",
          widgets_values: [42, "fixed", 30, 6.5, "dpmpp_2m", "karras", 1],
        },
        { id: 3, type: "CheckpointLoaderSimple", widgets_values: ["dreamshaper.safetensors"] },
      ],
    });
    const result = detectAiFromSource(source("workflow", workflow));

    expect(result?.generator).toBe("comfyui");
    expect(result?.seed).toBe("42");
    expect(result?.steps).toBe("30");
    expect(result?.sampler).toBe("dpmpp_2m");
    expect(result?.model).toBe("dreamshaper.safetensors");
  });

  it("returns null for JSON that is not a node graph", () => {
    expect(detectAiFromSource(source("Description", '{"hello":"world"}'))).toBeNull();
  });

  it("still flags an unrecognised payload stored under a generator key", () => {
    // A PNG `prompt` chunk is a generator artefact even when the schema is new.
    const result = detectAiFromSource(source("prompt", '{"hello":"world"}'));
    expect(result?.generator).toBe("generic");
    expect(result?.confidence).toBe("likely");
  });
});

describe("JSON generators", () => {
  it("parses NovelAI", () => {
    const result = detectAiFromSource(source("Comment", NOVELAI_COMMENT));
    expect(result?.generator).toBe("novelai");
    expect(result?.prompt).toBe("1girl, forest, masterpiece");
    expect(result?.negativePrompt).toBe("lowres, bad anatomy");
    expect(result?.sampler).toBe("k_euler_ancestral");
    expect(result?.fields.Size).toBe("832x1216");
  });

  it("parses Fooocus", () => {
    const payload = JSON.stringify({
      prompt: "a marble statue",
      negative_prompt: "blurry",
      base_model: "juggernautXL.safetensors",
      refiner_model: "None",
      guidance_scale: 4,
      sharpness: 2,
      seed: "778899",
      steps: 30,
      sampler: "dpmpp_2m_sde_gpu",
      scheduler: "karras",
      resolution: "(1152, 896)",
      version: "Fooocus v2.5.5",
      loras: [{ name: "sdxl_lightning", weight: 0.6 }],
    });
    const result = detectAiFromSource(source("Comment", payload));

    expect(result?.generator).toBe("fooocus");
    expect(result?.model).toBe("juggernautXL.safetensors");
    expect(result?.cfgScale).toBe("4");
    expect(result?.loras).toEqual(["sdxl_lightning"]);
  });

  it("parses modern and legacy InvokeAI schemas", () => {
    const modern = JSON.stringify({
      positive_prompt: "an astronaut riding a horse",
      negative_prompt: "cartoon",
      seed: 4242,
      steps: 40,
      cfg_scale: 7,
      scheduler: "euler_a",
      model: { model_name: "sdxl-base", base: "sdxl" },
      width: 1024,
      height: 1024,
    });
    const modernResult = detectAiFromSource(source("invokeai_metadata", modern));
    expect(modernResult?.generator).toBe("invokeai");
    expect(modernResult?.model).toBe("sdxl-base");
    expect(modernResult?.scheduler).toBe("euler_a");

    const legacy = JSON.stringify({
      model_weights: "stable-diffusion-1.5",
      image: {
        prompt: [{ prompt: "a lighthouse", weight: 1 }],
        seed: 12,
        steps: 50,
        cfg_scale: 7.5,
        sampler: "k_lms",
        width: 512,
        height: 512,
      },
    });
    const legacyResult = detectAiFromSource(source("sd-metadata", legacy));
    expect(legacyResult?.generator).toBe("invokeai");
    expect(legacyResult?.prompt).toBe("a lighthouse");
    expect(legacyResult?.sampler).toBe("k_lms");
  });

  it("parses a SwarmUI parameter block", () => {
    const payload = JSON.stringify({
      sui_image_params: {
        prompt: "a glass teapot",
        negativeprompt: "smudge",
        model: "flux1-schnell",
        seed: 7,
        steps: 4,
        cfgscale: 1,
        sampler: "euler",
        scheduler: "simple",
        width: 1024,
        height: 1024,
      },
    });
    const result = detectAiFromSource(source("parameters", payload));
    expect(result?.generator).toBe("stable-diffusion");
    expect(result?.prompt).toBe("a glass teapot");
    expect(result?.model).toBe("flux1-schnell");
  });
});

describe("Midjourney", () => {
  it("recognises command-line flags in a description", () => {
    const result = detectAiFromSource(
      source("ImageDescription", "a red fox in snow --ar 16:9 --v 6.1 --stylize 250 --no text"),
    );

    expect(result?.generator).toBe("midjourney");
    expect(result?.prompt).toBe("a red fox in snow");
    expect(result?.version).toBe("6.1");
    expect(result?.size).toBe("16:9");
    expect(result?.negativePrompt).toBe("text");
  });

  it("does not fire on a plain caption with a dash", () => {
    expect(detectAiFromSource(source("ImageDescription", "a red fox - winter series"))).toBeNull();
  });
});

describe("provenance detection", () => {
  it("names the generator from a C2PA claim generator", () => {
    const firefly = detectProvenanceGenerator({
      origin: "JPEG APP11",
      bytes: 4096,
      claimGenerator: "Adobe Firefly 3.0",
      digitalSourceType: "http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia",
    });
    expect(firefly?.generator).toBe("adobe-firefly");
    expect(firefly?.confidence).toBe("confirmed");

    const openai = detectProvenanceGenerator({
      origin: "PNG caBX",
      bytes: 2048,
      claimGenerator: "OpenAI DALL-E 3",
    });
    expect(openai?.generator).toBe("openai");

    const imagen = detectProvenanceGenerator({
      origin: "XMP",
      bytes: 0,
      creatorTool: "Google Imagen 3 with SynthID",
    });
    expect(imagen?.generator).toBe("google-imagen");
  });

  it("still flags AI when only the IPTC source type says so", () => {
    const result = detectProvenanceGenerator({
      origin: "XMP",
      bytes: 0,
      digitalSourceType: "trainedAlgorithmicMedia",
    });
    expect(result?.generator).toBe("generic");
    expect(result?.confidence).toBe("confirmed");
  });

  it("returns null for an ordinary photo pipeline", () => {
    expect(
      detectProvenanceGenerator({
        origin: "XMP",
        bytes: 0,
        creatorTool: "Adobe Lightroom Classic 13.2",
        software: "Canon EOS Utility",
      }),
    ).toBeNull();
  });
});

describe("signature heuristics", () => {
  it("separates generation metadata from ordinary text", () => {
    expect(containsAiSignature(A1111_PARAMETERS)).toBe(true);
    expect(containsAiSignature(COMFY_PROMPT)).toBe(true);
    expect(containsAiSignature("Shot on a rainy afternoon in Antananarivo")).toBe(false);
    expect(containsAiSignature("")).toBe(false);
  });
});

describe("de-duplication", () => {
  it("prefers a specific schema over the generic fallback", () => {
    const results = detectAiMetadata([
      source("parameters", A1111_PARAMETERS),
      source("Comment", "seed: 5, scheduler: karras, Clip skip: 2"),
    ]);
    expect(results.every((entry) => entry.generator !== "generic")).toBe(true);
  });

  it("merges the same finding reported from two places", () => {
    const results = detectAiMetadata([
      source("parameters", A1111_PARAMETERS),
      source("UserComment", A1111_PARAMETERS),
    ]);
    expect(results).toHaveLength(1);
    expect(results[0].bytes).toBe(A1111_PARAMETERS.length * 2);
  });
});
