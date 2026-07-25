import type { AiMetadata } from "@/types/metadata";
import { sanitizeForDisplay } from "../../utils/text";
import { createMetadata, setField, type AiTextSource } from "./types";

type Json = Record<string, unknown>;

function parseObject(text: string): Json | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Json;
  } catch {
    return null;
  }
}

function text(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

function names(value: unknown, keys: readonly string[]): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === "string") {
      out.push(item);
      continue;
    }
    if (Array.isArray(item) && typeof item[0] === "string") {
      out.push(item[0]);
      continue;
    }
    if (item && typeof item === "object") {
      const record = item as Json;
      for (const key of keys) {
        const found = text(record[key]);
        if (found) {
          out.push(found);
          break;
        }
      }
    }
  }
  return out.filter((entry) => entry && entry !== "None");
}

/**
 * NovelAI writes `Software: NovelAI` alongside a `Comment` object holding the
 * sampler settings, with the negative prompt under the `uc` key.
 */
export function parseNovelAi(source: AiTextSource): AiMetadata | null {
  const data = parseObject(source.text);
  if (!data) return null;

  const hasNovelAiShape =
    ("uc" in data && "sampler" in data) ||
    ("steps" in data && "scale" in data && "uc" in data);
  if (!hasNovelAiShape) return null;

  const metadata = createMetadata("novelai", source, "confirmed");
  const prompt = text(data.prompt) ?? text(data.v4_prompt);
  if (prompt) metadata.prompt = sanitizeForDisplay(prompt, 8000);
  const negative = text(data.uc);
  if (negative) metadata.negativePrompt = sanitizeForDisplay(negative, 8000);

  metadata.seed = setField(metadata, "Seed", data.seed);
  metadata.steps = setField(metadata, "Steps", data.steps);
  metadata.cfgScale = setField(metadata, "Scale", data.scale);
  metadata.sampler = setField(metadata, "Sampler", data.sampler);
  metadata.scheduler = setField(metadata, "Noise schedule", data.noise_schedule);
  metadata.model = setField(metadata, "Model", data.request_type ?? data.source);
  setField(metadata, "Strength", data.strength);
  setField(metadata, "Noise", data.noise);
  setField(metadata, "Size", sizeOf(data));
  return metadata;
}

/** Fooocus stores a flat settings object, tagged by `fooocus_scheme` or `Version`. */
export function parseFooocus(source: AiTextSource): AiMetadata | null {
  const data = parseObject(source.text);
  if (!data) return null;

  const isFooocus =
    "base_model" in data ||
    "full_prompt" in data ||
    String(text(data.version) ?? "").toLowerCase().includes("fooocus") ||
    source.key === "fooocus_scheme";
  if (!isFooocus) return null;

  const metadata = createMetadata("fooocus", source, "confirmed");
  const prompt = text(data.prompt) ?? text(data.full_prompt);
  if (prompt) metadata.prompt = sanitizeForDisplay(prompt, 8000);
  const negative = text(data.negative_prompt) ?? text(data.full_negative_prompt);
  if (negative) metadata.negativePrompt = sanitizeForDisplay(negative, 8000);

  metadata.seed = setField(metadata, "Seed", data.seed);
  metadata.steps = setField(metadata, "Steps", data.steps);
  metadata.cfgScale = setField(
    metadata,
    "Guidance scale",
    data.guidance_scale ?? data.cfg_scale,
  );
  metadata.sampler = setField(metadata, "Sampler", data.sampler);
  metadata.scheduler = setField(metadata, "Scheduler", data.scheduler);
  metadata.model = setField(metadata, "Base model", data.base_model);
  metadata.checkpoint = setField(metadata, "Refiner model", data.refiner_model);
  metadata.vae = setField(metadata, "VAE", data.vae_name ?? data.vae);
  metadata.size = setField(metadata, "Resolution", data.resolution ?? sizeOf(data));
  metadata.version = setField(metadata, "Version", data.version);
  setField(metadata, "Performance", data.performance);
  setField(metadata, "Sharpness", data.sharpness);
  setField(metadata, "Styles", Array.isArray(data.styles) ? data.styles.join(", ") : undefined);

  const loras = names(data.loras, ["name", "model", "lora"]);
  if (loras.length > 0) {
    metadata.loras = loras;
    setField(metadata, "LoRA", loras.join(", "));
  }
  return metadata;
}

/** InvokeAI ships two schemas: the modern `invokeai_metadata` and legacy `sd-metadata`. */
export function parseInvokeAi(source: AiTextSource): AiMetadata | null {
  const data = parseObject(source.text);
  if (!data) return null;

  const modern = "positive_prompt" in data || "negative_prompt" in data;
  const legacy = "image" in data && typeof data.image === "object";
  if (!modern && !legacy) return null;
  if (modern && !("scheduler" in data) && !("model" in data) && source.key !== "invokeai_metadata") {
    return null;
  }

  const metadata = createMetadata("invokeai", source, "confirmed");

  if (modern) {
    const prompt = text(data.positive_prompt);
    if (prompt) metadata.prompt = sanitizeForDisplay(prompt, 8000);
    const negative = text(data.negative_prompt);
    if (negative) metadata.negativePrompt = sanitizeForDisplay(negative, 8000);
    metadata.seed = setField(metadata, "Seed", data.seed);
    metadata.steps = setField(metadata, "Steps", data.steps);
    metadata.cfgScale = setField(metadata, "CFG scale", data.cfg_scale);
    metadata.scheduler = setField(metadata, "Scheduler", data.scheduler);
    metadata.model = setField(metadata, "Model", modelName(data.model));
    metadata.vae = setField(metadata, "VAE", modelName(data.vae));
    metadata.size = setField(metadata, "Size", sizeOf(data));
    metadata.clipSkip = setField(metadata, "Clip skip", data.clip_skip);
    const loras = names(data.loras, ["model", "lora", "name"]).concat(
      names(data.loras, ["lora_name"]),
    );
    if (loras.length > 0) {
      metadata.loras = [...new Set(loras)];
      setField(metadata, "LoRA", metadata.loras.join(", "));
    }
    const controlNets = names(data.controlnets ?? data.control_layers, [
      "control_model",
      "model",
      "name",
    ]);
    if (controlNets.length > 0) {
      metadata.controlNets = controlNets;
      setField(metadata, "ControlNet", controlNets.join(", "));
    }
    return metadata;
  }

  const image = data.image as Json;
  const promptField = image.prompt;
  let prompt: string | undefined;
  if (Array.isArray(promptField)) {
    prompt = promptField
      .map((entry) =>
        entry && typeof entry === "object" ? text((entry as Json).prompt) : text(entry),
      )
      .filter(Boolean)
      .join(", ");
  } else {
    prompt = text(promptField);
  }
  if (prompt) metadata.prompt = sanitizeForDisplay(prompt, 8000);
  metadata.seed = setField(metadata, "Seed", image.seed);
  metadata.steps = setField(metadata, "Steps", image.steps);
  metadata.cfgScale = setField(metadata, "CFG scale", image.cfg_scale);
  metadata.sampler = setField(metadata, "Sampler", image.sampler);
  metadata.model = setField(metadata, "Model", data.model_weights);
  metadata.size = setField(metadata, "Size", sizeOf(image));
  return metadata;
}

function modelName(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const record = value as Json;
    return (
      text(record.model_name) ??
      text(record.name) ??
      text(record.key) ??
      text(record.hash)
    );
  }
  return undefined;
}

function sizeOf(data: Json): string | undefined {
  const width = data.width;
  const height = data.height;
  if (typeof width === "number" && typeof height === "number") {
    return `${width}x${height}`;
  }
  return undefined;
}
