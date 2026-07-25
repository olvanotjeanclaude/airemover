import type { RemovableCategory, RemovalOptions } from "@/types/metadata";
import {
  addRemoved,
  createTally,
  switchForSegment,
  type ContainerCleanResult,
  type PreservedItem,
} from "../cleaner/types";
import { filterTiffTree, parseTiff, writeTiff } from "../exif";
import { containsAiSignature, isAiTextKey } from "../parser/ai/signals";
import { ByteWriter, bytesOfAscii } from "../utils/bytes";
import { crc32 } from "../utils/crc32";
import { stripAiFromXmp, stripProvenanceFromXmp } from "../xmp";
import { PNG_SIGNATURE, classifyChunk, parsePng, type PngChunk, type PngFile } from "./chunks";
import { XMP_KEYWORD, decodePngText } from "./text";

/**
 * Decides which switch controls a chunk. Text chunks are ambiguous by design:
 * the same `iTXt` may hold an XMP packet, a ComfyUI workflow or a copyright
 * line, so the payload has to be read before it can be categorised.
 */
export function categorizeChunk(chunk: PngChunk): RemovableCategory | null {
  const base = classifyChunk(chunk.type);
  if (base === "structural") return null;

  if (base === "comment") {
    const decoded = decodePngText(chunk);
    if (!decoded) return "comment";
    if (decoded.keyword === XMP_KEYWORD) return "xmp";
    if (isAiTextKey(decoded.keyword) || containsAiSignature(decoded.text)) return "ai";
    return "comment";
  }

  return switchForSegment(base);
}

export function cleanPng(
  bytes: Uint8Array,
  file: PngFile,
  options: RemovalOptions,
): ContainerCleanResult {
  const removed = createTally();
  const preserved: PreservedItem[] = [];
  const warnings = [...file.warnings];
  const output = new ByteWriter(bytes.length);
  output.raw(PNG_SIGNATURE);

  for (const chunk of file.chunks) {
    if (chunk.critical) {
      writeChunk(output, chunk.type, chunk.data);
      continue;
    }

    const category = categorizeChunk(chunk);
    if (category === null) {
      writeChunk(output, chunk.type, chunk.data);
      continue;
    }

    if (options[category]) {
      addRemoved(removed, category, chunk.size);
      continue;
    }

    const rewritten = rewriteChunk(chunk, category, options, warnings);
    if (rewritten && rewritten.data.length < chunk.data.length) {
      writeChunk(output, chunk.type, rewritten.data);
      addRemoved(removed, rewritten.category, chunk.data.length - rewritten.data.length);
      continue;
    }

    writeChunk(output, chunk.type, chunk.data);
  }

  if (file.trailingBytes > 0) {
    addRemoved(removed, "other", file.trailingBytes);
  }

  return {
    bytes: output.finish(),
    removed,
    preserved,
    warnings,
    pixelStreamPreserved: true,
  };
}

/** Re-emits a chunk with a freshly computed CRC, as the specification requires. */
function writeChunk(output: ByteWriter, type: string, data: Uint8Array): void {
  const typeBytes = bytesOfAscii(type);
  output.u32(data.length);
  output.raw(typeBytes);
  output.raw(data);
  output.u32(crc32(typeBytes, data));
}

interface RewrittenChunk {
  data: Uint8Array;
  category: RemovableCategory;
}

function rewriteChunk(
  chunk: PngChunk,
  category: RemovableCategory,
  options: RemovalOptions,
  warnings: string[],
): RewrittenChunk | null {
  if (chunk.type === "eXIf" && !options.exif) {
    try {
      const tree = parseTiff(chunk.data);
      const outcome = filterTiffTree(tree, options, "embedded");
      if (!outcome.changed) return null;
      if (!outcome.tree) return { data: new Uint8Array(0), category: "exif" };
      let dominant: RemovableCategory = "exif";
      let best = -1;
      for (const [name, tally] of outcome.removed) {
        if (tally.bytes > best) {
          best = tally.bytes;
          dominant = name;
        }
      }
      return { data: writeTiff(outcome.tree), category: dominant };
    } catch (error) {
      warnings.push(
        `The eXIf chunk could not be rewritten (${error instanceof Error ? error.message : "unknown error"})`,
      );
      return null;
    }
  }

  if (category === "xmp" && !options.xmp && (options.ai || options.c2pa)) {
    const decoded = decodePngText(chunk);
    if (!decoded || decoded.compressed) return null;
    let text = decoded.text;
    let effective: RemovableCategory | null = null;
    if (options.ai) {
      const stripped = stripAiFromXmp(text, containsAiSignature);
      if (stripped.changed) {
        text = stripped.text;
        effective = "ai";
      }
    }
    if (options.c2pa) {
      const stripped = stripProvenanceFromXmp(text);
      if (stripped.changed) {
        text = stripped.text;
        effective = effective ?? "c2pa";
      }
    }
    if (!effective) return null;
    return { data: rebuildItxt(chunk, decoded.keyword, decoded.languageTag, text), category: effective };
  }

  return null;
}

/** Rebuilds an uncompressed iTXt chunk around replacement text. */
function rebuildItxt(
  chunk: PngChunk,
  keyword: string,
  languageTag: string | undefined,
  text: string,
): Uint8Array {
  const writer = new ByteWriter(text.length + keyword.length + 16);
  writer.raw(bytesOfAscii(keyword));
  writer.u8(0);
  writer.u8(0); // compression flag: stored
  writer.u8(0); // compression method
  writer.raw(bytesOfAscii(languageTag ?? ""));
  writer.u8(0);
  writer.u8(0); // empty translated keyword
  writer.raw(new TextEncoder().encode(text));
  const rebuilt = writer.finish();
  return rebuilt.length < chunk.data.length ? rebuilt : chunk.data;
}

/** Convenience wrapper used by the dispatcher, which does not hold a parse. */
export function cleanPngBytes(
  bytes: Uint8Array,
  options: RemovalOptions,
): ContainerCleanResult {
  return cleanPng(bytes, parsePng(bytes), options);
}
