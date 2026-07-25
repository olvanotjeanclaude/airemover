import type { RemovableCategory, RemovalOptions } from "@/types/metadata";
import {
  addRemoved,
  createTally,
  switchForSegment,
  type ContainerCleanResult,
  type PreservedItem,
} from "../cleaner/types";
import { filterTiffTree, parseTiff, writeTiff } from "../exif";
import { containsAiSignature } from "../parser/ai/signals";
import { ByteWriter } from "../utils/bytes";
import { decodeUtf8 } from "../utils/text";
import { extractXmpPacket, stripAiFromXmp, stripProvenanceFromXmp } from "../xmp";
import {
  VP8X_FLAG,
  classifyRiffChunk,
  parseWebp,
  type RiffChunk,
  type WebpFile,
} from "./riff";

/**
 * Rebuilds the RIFF container without the selected chunks. The VP8X flag byte
 * is updated to match, because a decoder that sees the EXIF flag set with no
 * EXIF chunk present is entitled to reject the file.
 */
export function cleanWebp(
  bytes: Uint8Array,
  file: WebpFile,
  options: RemovalOptions,
): ContainerCleanResult {
  const removed = createTally();
  const preserved: PreservedItem[] = [];
  const warnings = [...file.warnings];

  const kept: { fourCc: string; payload: Uint8Array }[] = [];

  for (const chunk of file.chunks) {
    const base = classifyRiffChunk(chunk.fourCc);
    const category = switchForSegment(base);

    if (category === null) {
      kept.push({ fourCc: chunk.fourCc, payload: chunk.payload });
      continue;
    }

    if (options[category]) {
      addRemoved(removed, category, chunk.totalSize);
      continue;
    }

    const rewritten = rewriteChunk(chunk, options, warnings);
    if (rewritten && rewritten.payload.length < chunk.payload.length) {
      kept.push({ fourCc: chunk.fourCc, payload: rewritten.payload });
      addRemoved(
        removed,
        rewritten.category,
        chunk.payload.length - rewritten.payload.length,
      );
      continue;
    }

    kept.push({ fourCc: chunk.fourCc, payload: chunk.payload });
  }

  const survivingFourCcs = new Set(kept.map((chunk) => chunk.fourCc));
  const vp8x = kept.find((chunk) => chunk.fourCc === "VP8X");
  if (vp8x && vp8x.payload.length >= 10) {
    const updated = vp8x.payload.slice();
    let flags = updated[0];
    if (!survivingFourCcs.has("EXIF")) flags &= ~VP8X_FLAG.Exif;
    if (!survivingFourCcs.has("XMP ")) flags &= ~VP8X_FLAG.Xmp;
    if (!survivingFourCcs.has("ICCP")) flags &= ~VP8X_FLAG.Icc;
    updated[0] = flags & 0xff;
    vp8x.payload = updated;
  }

  const body = new ByteWriter(bytes.length);
  body.ascii("WEBP");
  for (const chunk of kept) {
    body.ascii(chunk.fourCc);
    body.u32(chunk.payload.length, true);
    body.raw(chunk.payload);
    if (chunk.payload.length % 2 === 1) body.u8(0);
  }
  const bodyBytes = body.finish();

  const output = new ByteWriter(bodyBytes.length + 8);
  output.ascii("RIFF");
  output.u32(bodyBytes.length, true);
  output.raw(bodyBytes);

  return {
    bytes: output.finish(),
    removed,
    preserved,
    warnings,
    pixelStreamPreserved: true,
  };
}

interface RewrittenChunk {
  payload: Uint8Array;
  category: RemovableCategory;
}

function rewriteChunk(
  chunk: RiffChunk,
  options: RemovalOptions,
  warnings: string[],
): RewrittenChunk | null {
  if (chunk.fourCc === "EXIF" && !options.exif) {
    try {
      const tree = parseTiff(chunk.payload);
      const outcome = filterTiffTree(tree, options, "embedded");
      if (!outcome.changed) return null;
      if (!outcome.tree) return { payload: new Uint8Array(0), category: "exif" };
      let dominant: RemovableCategory = "exif";
      let best = -1;
      for (const [name, tally] of outcome.removed) {
        if (tally.bytes > best) {
          best = tally.bytes;
          dominant = name;
        }
      }
      return { payload: writeTiff(outcome.tree), category: dominant };
    } catch (error) {
      warnings.push(
        `The WebP EXIF chunk could not be rewritten (${error instanceof Error ? error.message : "unknown error"})`,
      );
      return null;
    }
  }

  if (chunk.fourCc === "XMP " && !options.xmp && (options.ai || options.c2pa)) {
    const packet = extractXmpPacket(chunk.payload);
    if (!packet) return null;
    let text = packet.text;
    let category: RemovableCategory | null = null;
    if (options.ai) {
      const stripped = stripAiFromXmp(text, containsAiSignature);
      if (stripped.changed) {
        text = stripped.text;
        category = "ai";
      }
    }
    if (options.c2pa) {
      const stripped = stripProvenanceFromXmp(text);
      if (stripped.changed) {
        text = stripped.text;
        category = category ?? "c2pa";
      }
    }
    if (!category) return null;
    return { payload: new TextEncoder().encode(text), category };
  }

  return null;
}

/** Reads an XMP chunk as text, used by the inspector. */
export function readWebpXmp(chunk: RiffChunk): string {
  return decodeUtf8(chunk.payload);
}

export function cleanWebpBytes(
  bytes: Uint8Array,
  options: RemovalOptions,
): ContainerCleanResult {
  return cleanWebp(bytes, parseWebp(bytes), options);
}
