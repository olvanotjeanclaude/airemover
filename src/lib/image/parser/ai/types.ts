import type { AiGenerator, AiMetadata } from "@/types/metadata";

/**
 * A candidate blob of text pulled out of a container, tagged with where it came
 * from. Detectors are pure functions over these, which keeps generator support
 * completely independent of the JPEG/PNG/WebP layers.
 */
export interface AiTextSource {
  /** Human-readable origin, e.g. "PNG tEXt:parameters". */
  origin: string;
  /** Normalised key: `parameters`, `prompt`, `workflow`, `Comment`, and so on. */
  key: string;
  text: string;
  bytes: number;
}

export type AiDetector = (source: AiTextSource) => AiMetadata | null;

export const GENERATOR_LABELS: Record<AiGenerator, string> = {
  automatic1111: "Automatic1111 / WebUI",
  "stable-diffusion": "Stable Diffusion",
  comfyui: "ComfyUI",
  fooocus: "Fooocus",
  invokeai: "InvokeAI",
  novelai: "NovelAI",
  flux: "Flux",
  midjourney: "Midjourney",
  "adobe-firefly": "Adobe Firefly",
  openai: "OpenAI Images",
  "google-imagen": "Google Imagen",
  generic: "Unidentified generator",
};

export function createMetadata(
  generator: AiGenerator,
  source: AiTextSource,
  confidence: "confirmed" | "likely",
): AiMetadata {
  return {
    generator,
    generatorLabel: GENERATOR_LABELS[generator],
    confidence,
    source: source.origin,
    fields: {},
    bytes: source.bytes,
  };
}

/** Assigns a field only when the value is meaningful, keeping `fields` clean. */
export function setField(
  metadata: AiMetadata,
  key: string,
  value: unknown,
): string | undefined {
  if (value === null || value === undefined) return undefined;
  const text = typeof value === "string" ? value.trim() : String(value);
  if (!text || text === "undefined" || text === "null") return undefined;
  metadata.fields[key] = text;
  return text;
}
