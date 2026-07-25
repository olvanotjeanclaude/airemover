/**
 * Fast, allocation-free tests used wherever a decision has to be made about a
 * blob of text *before* committing to a full parse: EXIF tag filtering, XMP
 * property stripping and PNG chunk classification all rely on these.
 */

const STRONG_MARKERS: readonly RegExp[] = [
  /Negative prompt:/i,
  /\bSteps:\s*\d+/,
  /\bSampler:\s*\S/i,
  /\bCFG scale:\s*[\d.]/i,
  /"class_type"\s*:/,
  /"sui_image_params"/i,
  /"invokeai_metadata"|"positive_prompt"\s*:/i,
  /"sd-metadata"|"model_weights"\s*:/i,
  /"fooocus[_ ]scheme"|"base_model"\s*:/i,
  /\bnovelai\b/i,
  /\bstable\s*diffusion\b/i,
  /\bcomfyui\b/i,
  /\bautomatic1111\b/i,
  /\bmidjourney\b/i,
  /\bdall[\s.-]?e\b/i,
  /\badobe\s+firefly\b/i,
  /trainedAlgorithmicMedia/i,
  /<lora:[^:>]+:/i,
];

const WEAK_MARKERS: readonly RegExp[] = [
  /--(?:v|ar|stylize|niji)\s+\S/i,
  /"seed"\s*:\s*\d/i,
  /"scheduler"\s*:/i,
  /\bDenoising strength:/i,
  /\bModel hash:/i,
  /\bClip skip:/i,
];

/** True when text is almost certainly generation metadata rather than a caption. */
export function containsAiSignature(text: string): boolean {
  if (!text || text.length < 6) return false;
  const sample = text.length > 20000 ? text.slice(0, 20000) : text;
  if (STRONG_MARKERS.some((pattern) => pattern.test(sample))) return true;
  let weakHits = 0;
  for (const pattern of WEAK_MARKERS) {
    if (pattern.test(sample)) weakHits += 1;
    if (weakHits >= 2) return true;
  }
  return false;
}

/** PNG text keys and EXIF-adjacent names that only generators ever write. */
const AI_KEYS = new Set([
  "parameters",
  "prompt",
  "workflow",
  "negative_prompt",
  "sd-metadata",
  "invokeai_metadata",
  "invokeai_graph",
  "invokeai_workflow",
  "fooocus_scheme",
  "comfy",
  "aiinfo",
  "generation_data",
  "sui_image_params",
  "extras",
]);

export function isAiTextKey(key: string): boolean {
  return AI_KEYS.has(key.trim().toLowerCase());
}
