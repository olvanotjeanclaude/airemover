import type { MetadataSegment } from "@/types/metadata";
import { collectExifAiSources, parseTiff } from "../exif";
import { createBundle, type ParsedContainer } from "../parser/types";
import { extractXmpPacket } from "../xmp";
import { classifyRiffChunk, parseWebp, riffChunkLabel } from "./riff";

export function inspectWebp(bytes: Uint8Array): ParsedContainer {
  const file = parseWebp(bytes);
  const bundle = createBundle();
  const segments: MetadataSegment[] = [];
  const warnings = [...file.warnings];

  for (const chunk of file.chunks) {
    const category = classifyRiffChunk(chunk.fourCc);
    if (category === "structural") continue;

    segments.push({
      id: `${chunk.fourCc.trim()}@${chunk.offset}`,
      category,
      container: chunk.fourCc.trim(),
      label: riffChunkLabel(chunk.fourCc),
      offset: chunk.offset,
      size: chunk.totalSize,
    });

    if (chunk.fourCc === "EXIF") {
      bundle.exifPayloads.push(chunk.payload);
    } else if (chunk.fourCc === "XMP ") {
      const packet = extractXmpPacket(chunk.payload);
      if (packet) {
        bundle.xmpPackets.push(packet.text);
        bundle.xmpBytes += chunk.totalSize;
      }
    } else if (chunk.fourCc === "ICCP") {
      bundle.iccPayloads.push(chunk.payload);
    } else if (chunk.fourCc === "C2PA") {
      bundle.c2paPayloads.push(chunk.payload);
      bundle.c2paLocation = "WebP C2PA chunk (JUMBF)";
    }
  }

  for (const payload of bundle.exifPayloads) {
    try {
      const tree = parseTiff(payload);
      bundle.aiSources.push(...collectExifAiSources(tree, "WebP EXIF"));
    } catch {
      // Reported by the summary layer.
    }
  }

  for (const packet of bundle.xmpPackets) {
    bundle.aiSources.push({
      origin: "WebP XMP",
      key: "xmp",
      text: packet,
      bytes: packet.length,
    });
  }

  return {
    format: "webp",
    container: {
      format: "webp",
      width: file.width,
      height: file.height,
      colorSpace: "YCbCr",
      channels: file.hasAlpha ? 4 : 3,
      hasAlpha: file.hasAlpha,
      isAnimated: file.isAnimated,
      isProgressive: false,
      encoding: file.encoding,
    },
    segments,
    bundle,
    warnings,
    losslessSupported: true,
  };
}
