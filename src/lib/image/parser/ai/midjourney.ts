import type { AiMetadata } from "@/types/metadata";
import { sanitizeForDisplay } from "../../utils/text";
import { createMetadata, setField, type AiTextSource } from "./types";

/**
 * Midjourney leaves no structured block: the prompt lands in the EXIF image
 * description (or XMP) with its command-line flags still attached, e.g.
 * `a red fox in snow --ar 16:9 --v 6.1 --stylize 250`.
 */
const FLAG_PATTERN =
  /--(?:v|version|ar|aspect|q|quality|s|stylize|style|chaos|c|niji|seed|no|iw|weird|w|sref|cref|cw|profile|p|tile|repeat|r)\b/gi;

const NAMED_FLAG = (name: string): RegExp =>
  new RegExp(`--(?:${name})\\s+([^\\s-][^\\s]*)`, "i");

export function parseMidjourney(source: AiTextSource): AiMetadata | null {
  const text = source.text.trim();
  if (!text || text.length > 4000) return null;

  FLAG_PATTERN.lastIndex = 0;
  const flags = text.match(FLAG_PATTERN);
  const namesMidjourney = /midjourney/i.test(text);
  if (!namesMidjourney && (!flags || flags.length < 1)) return null;
  // A single generic flag is not enough; require either the brand name or a
  // version/aspect flag, which nothing else writes into a description field.
  if (!namesMidjourney && !/--(?:v|version|ar|aspect|niji|stylize)\b/i.test(text)) {
    return null;
  }

  const metadata = createMetadata("midjourney", source, namesMidjourney ? "confirmed" : "likely");
  const promptText = text.split(/\s--/)[0]?.trim();
  if (promptText) metadata.prompt = sanitizeForDisplay(promptText, 4000);

  metadata.version = setField(
    metadata,
    "Version",
    NAMED_FLAG("v|version").exec(text)?.[1] ??
      (/--niji\s*(\d+)?/i.exec(text) ? "niji" : undefined),
  );
  metadata.seed = setField(metadata, "Seed", NAMED_FLAG("seed").exec(text)?.[1]);
  metadata.size = setField(
    metadata,
    "Aspect ratio",
    NAMED_FLAG("ar|aspect").exec(text)?.[1],
  );
  setField(metadata, "Stylize", NAMED_FLAG("s|stylize").exec(text)?.[1]);
  setField(metadata, "Chaos", NAMED_FLAG("c|chaos").exec(text)?.[1]);
  setField(metadata, "Quality", NAMED_FLAG("q|quality").exec(text)?.[1]);

  const negative = NAMED_FLAG("no").exec(text)?.[1];
  if (negative) metadata.negativePrompt = sanitizeForDisplay(negative, 500);

  return metadata;
}
