import type { AiMetadata } from "@/types/metadata";
import { parseAutomatic1111 } from "./automatic1111";
import { parseComfyUi } from "./comfyui";
import { parseFooocus, parseInvokeAi, parseNovelAi } from "./json-generators";
import { parseMidjourney } from "./midjourney";
import { containsAiSignature, isAiTextKey } from "./signals";
import { createMetadata, setField, type AiDetector, type AiTextSource } from "./types";

export { containsAiSignature, isAiTextKey } from "./signals";
export { detectProvenanceGenerator, type ProvenanceSignals } from "./provenance";
export { GENERATOR_LABELS, type AiTextSource } from "./types";

/**
 * Order matters: the JSON schemas are checked before the loose key/value
 * formats, because a ComfyUI graph also happens to satisfy some of the weaker
 * heuristics further down the list.
 */
const DETECTORS: readonly AiDetector[] = [
  parseComfyUi,
  parseNovelAi,
  parseFooocus,
  parseInvokeAi,
  parseAutomatic1111,
  parseMidjourney,
  parseSwarmUi,
  parseGeneric,
];

/** SwarmUI wraps Automatic1111-style values in a `sui_image_params` object. */
function parseSwarmUi(source: AiTextSource): AiMetadata | null {
  const trimmed = source.text.trim();
  if (!trimmed.startsWith("{") || !trimmed.includes("sui_image_params")) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  const root = parsed as Record<string, unknown>;
  const params = root.sui_image_params;
  if (!params || typeof params !== "object") return null;
  const values = params as Record<string, unknown>;

  const metadata = createMetadata("stable-diffusion", source, "confirmed");
  metadata.generatorLabel = "SwarmUI / Stable Diffusion";
  const prompt = values.prompt;
  if (typeof prompt === "string") metadata.prompt = prompt.trim();
  const negative = values.negativeprompt ?? values.negative_prompt;
  if (typeof negative === "string") metadata.negativePrompt = negative.trim();
  metadata.seed = setField(metadata, "Seed", values.seed);
  metadata.steps = setField(metadata, "Steps", values.steps);
  metadata.cfgScale = setField(metadata, "CFG scale", values.cfgscale);
  metadata.sampler = setField(metadata, "Sampler", values.sampler);
  metadata.scheduler = setField(metadata, "Scheduler", values.scheduler);
  metadata.model = setField(metadata, "Model", values.model);
  metadata.vae = setField(metadata, "VAE", values.vae);
  metadata.size = setField(
    metadata,
    "Size",
    typeof values.width === "number" && typeof values.height === "number"
      ? `${values.width}x${values.height}`
      : undefined,
  );
  const loras = values.loras;
  if (Array.isArray(loras) && loras.length > 0) {
    metadata.loras = loras.map(String);
    setField(metadata, "LoRA", metadata.loras.join(", "));
  }
  return metadata;
}

/**
 * Last resort: the text carries an unmistakable generator signature but matches
 * no known schema. Reporting it as an unidentified generator is better than
 * silently dropping evidence the user asked us to find.
 */
function parseGeneric(source: AiTextSource): AiMetadata | null {
  if (!containsAiSignature(source.text) && !isAiTextKey(source.key)) return null;
  const metadata = createMetadata("generic", source, "likely");
  metadata.prompt = source.text.slice(0, 2000).trim() || undefined;
  setField(metadata, "Key", source.key);
  return metadata;
}

/** Runs every detector over one candidate, returning the first schema that fits. */
export function detectAiFromSource(source: AiTextSource): AiMetadata | null {
  if (!source.text) return null;
  for (const detector of DETECTORS) {
    try {
      const result = detector(source);
      if (result) return result;
    } catch {
      // A malformed generator blob must never abort the whole inspection.
    }
  }
  return null;
}

/** De-duplicates by generator and prompt so one image reports one result. */
export function detectAiMetadata(
  sources: readonly AiTextSource[],
): AiMetadata[] {
  const found: AiMetadata[] = [];
  for (const source of sources) {
    const metadata = detectAiFromSource(source);
    if (!metadata) continue;
    const duplicate = found.find(
      (entry) =>
        entry.generator === metadata.generator &&
        entry.prompt === metadata.prompt &&
        entry.seed === metadata.seed,
    );
    if (duplicate) {
      duplicate.bytes += metadata.bytes;
      continue;
    }
    found.push(metadata);
  }

  // A specific schema always beats the generic fallback for the same image.
  const specific = found.filter((entry) => entry.generator !== "generic");
  return specific.length > 0 ? specific : found;
}
