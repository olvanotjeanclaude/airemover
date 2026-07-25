import type { AiGenerator, AiMetadata } from "@/types/metadata";
import { sanitizeForDisplay } from "../../utils/text";
import { isSettingsLine, parseSettingsPairs } from "./settings-line";
import { createMetadata, setField, type AiTextSource } from "./types";

const NEGATIVE_PREFIX = "Negative prompt:";

/**
 * Parses the Automatic1111 / Forge / SD.Next "parameters" block:
 *
 *   a photo of a cat
 *   Negative prompt: blurry, low quality
 *   Steps: 30, Sampler: DPM++ 2M, CFG scale: 7, Seed: 1234, Size: 512x512, ...
 *
 * Everything up to `Negative prompt:` is the positive prompt, everything after
 * it up to the settings line is the negative prompt, and the settings line is a
 * comma-separated key/value list. All three parts are optional in the wild.
 */
export function parseAutomatic1111(source: AiTextSource): AiMetadata | null {
  const text = source.text.replace(/\r\n/g, "\n").trim();
  if (!text) return null;

  const lines = text.split("\n");
  let settingsIndex = -1;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (isSettingsLine(lines[index])) {
      settingsIndex = index;
      break;
    }
  }

  const negativeIndex = lines.findIndex((line) =>
    line.trimStart().startsWith(NEGATIVE_PREFIX),
  );

  // Without a settings line and without a negative prompt this is just text.
  if (settingsIndex < 0 && negativeIndex < 0) return null;

  const promptEnd =
    negativeIndex >= 0
      ? negativeIndex
      : settingsIndex >= 0
        ? settingsIndex
        : lines.length;
  const prompt = lines.slice(0, promptEnd).join("\n").trim();

  let negative = "";
  if (negativeIndex >= 0) {
    const negativeEnd = settingsIndex > negativeIndex ? settingsIndex : lines.length;
    const block = lines.slice(negativeIndex, negativeEnd).join("\n").trim();
    negative = block.slice(NEGATIVE_PREFIX.length).trim();
  }

  const pairs =
    settingsIndex >= 0 ? parseSettingsPairs(lines[settingsIndex]) : new Map();

  const model = pairs.get("model") ?? pairs.get("checkpoint");
  const generator = pickGenerator(pairs, model, text);
  const metadata = createMetadata(generator, source, "confirmed");

  if (prompt) metadata.prompt = sanitizeForDisplay(prompt, 8000);
  if (negative) metadata.negativePrompt = sanitizeForDisplay(negative, 8000);
  metadata.seed = setField(metadata, "Seed", pairs.get("seed"));
  metadata.steps = setField(metadata, "Steps", pairs.get("steps"));
  metadata.cfgScale = setField(
    metadata,
    "CFG scale",
    pairs.get("cfg scale") ?? pairs.get("distilled cfg scale"),
  );
  metadata.sampler = setField(metadata, "Sampler", pairs.get("sampler"));
  metadata.scheduler = setField(metadata, "Scheduler", pairs.get("schedule type") ?? pairs.get("scheduler"));
  metadata.model = setField(metadata, "Model", model);
  metadata.checkpoint = setField(
    metadata,
    "Model hash",
    pairs.get("model hash") ?? pairs.get("checkpoint hash"),
  );
  metadata.vae = setField(metadata, "VAE", pairs.get("vae") ?? pairs.get("vae hash"));
  metadata.clipSkip = setField(metadata, "Clip skip", pairs.get("clip skip"));
  metadata.size = setField(metadata, "Size", pairs.get("size"));
  metadata.version = setField(metadata, "Version", pairs.get("version"));

  const loras = collectNames(
    pairs.get("lora hashes") ?? pairs.get("loras"),
    prompt,
    /<lora:([^:>]+)/gi,
  );
  if (loras.length > 0) {
    metadata.loras = loras;
    setField(metadata, "LoRA", loras.join(", "));
  }

  const controlNets = collectControlNet(pairs);
  if (controlNets.length > 0) {
    metadata.controlNets = controlNets;
    setField(metadata, "ControlNet", controlNets.join(", "));
  }

  for (const [key, value] of pairs) {
    if (!metadata.fields[key]) metadata.fields[key] = value;
  }

  return metadata;
}

function pickGenerator(
  pairs: Map<string, string>,
  model: string | undefined,
  text: string,
): AiGenerator {
  const haystack = `${model ?? ""} ${pairs.get("module 1") ?? ""} ${text.slice(0, 400)}`.toLowerCase();
  if (haystack.includes("flux")) return "flux";
  if (pairs.has("version")) {
    const version = (pairs.get("version") ?? "").toLowerCase();
    if (version.includes("forge") || version.startsWith("v1.")) return "automatic1111";
  }
  return "automatic1111";
}

/** LoRA names come either from a `Lora hashes` field or from `<lora:name:w>`. */
function collectNames(
  fieldValue: string | undefined,
  prompt: string,
  promptPattern: RegExp,
): string[] {
  const names = new Set<string>();

  if (fieldValue) {
    for (const token of fieldValue.split(",")) {
      const name = token.split(":")[0]?.trim();
      if (name) names.add(name);
    }
  }

  let match = promptPattern.exec(prompt);
  while (match) {
    if (match[1]) names.add(match[1].trim());
    match = promptPattern.exec(prompt);
  }

  return [...names];
}

function collectControlNet(pairs: Map<string, string>): string[] {
  const names = new Set<string>();
  for (const [key, value] of pairs) {
    if (!key.startsWith("controlnet")) continue;
    const model = /model:\s*([^,]+)/i.exec(value)?.[1] ?? value;
    if (model.trim()) names.add(model.trim());
  }
  return [...names];
}
