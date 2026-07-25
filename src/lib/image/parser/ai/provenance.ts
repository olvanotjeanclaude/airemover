import type { AiGenerator, AiMetadata } from "@/types/metadata";
import { GENERATOR_LABELS, setField } from "./types";

/**
 * Firefly, DALL·E and Imagen do not embed prompts. What they do embed is a
 * signed provenance trail: a C2PA claim generator, an XMP creator tool, and the
 * IPTC `DigitalSourceType` term that marks an image as machine-generated.
 */
export interface ProvenanceSignals {
  origin: string;
  bytes: number;
  claimGenerator?: string;
  creatorTool?: string;
  digitalSourceType?: string;
  software?: string;
  /** C2PA assertion labels, which sometimes name the model. */
  assertions?: readonly string[];
}

interface GeneratorRule {
  generator: AiGenerator;
  pattern: RegExp;
}

const RULES: readonly GeneratorRule[] = [
  { generator: "adobe-firefly", pattern: /firefly|adobe\s+express|adobe\s+photoshop\s+\(generative/i },
  { generator: "openai", pattern: /openai|dall[\s.-]?e|gpt[\s-]?image|chatgpt/i },
  { generator: "google-imagen", pattern: /imagen|synthid|google\s+(?:ai|deepmind|gemini)|pixel\s+studio/i },
  { generator: "midjourney", pattern: /midjourney/i },
  { generator: "flux", pattern: /\bflux\b|black\s*forest\s*labs/i },
  { generator: "stable-diffusion", pattern: /stability\s*ai|stable\s*diffusion|dreamstudio/i },
  { generator: "comfyui", pattern: /comfy/i },
  { generator: "novelai", pattern: /novelai/i },
];

const AI_SOURCE_TERMS = [
  "trainedalgorithmicmedia",
  "compositewithtrainedalgorithmicmedia",
  "algorithmicmedia",
];

export function detectProvenanceGenerator(
  signals: ProvenanceSignals,
): AiMetadata | null {
  const haystack = [
    signals.claimGenerator,
    signals.creatorTool,
    signals.software,
    ...(signals.assertions ?? []),
  ]
    .filter(Boolean)
    .join(" ");

  const sourceType = (signals.digitalSourceType ?? "").toLowerCase();
  const declaredAi = AI_SOURCE_TERMS.some((term) => sourceType.includes(term));

  const matched = RULES.find((rule) => rule.pattern.test(haystack));
  if (!matched && !declaredAi) return null;

  const generator = matched?.generator ?? "generic";
  const metadata: AiMetadata = {
    generator,
    generatorLabel: GENERATOR_LABELS[generator],
    confidence: matched && declaredAi ? "confirmed" : matched ? "likely" : "confirmed",
    source: signals.origin,
    fields: {},
    bytes: signals.bytes,
  };

  metadata.model = setField(metadata, "Claim generator", signals.claimGenerator);
  setField(metadata, "Creator tool", signals.creatorTool);
  setField(metadata, "Software", signals.software);
  setField(metadata, "Digital source type", signals.digitalSourceType);
  if (signals.assertions && signals.assertions.length > 0) {
    setField(metadata, "Assertions", signals.assertions.join(", "));
  }

  return metadata;
}
