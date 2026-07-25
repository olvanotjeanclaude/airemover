import type { MetadataSegment } from "@/types/metadata";
import { collectExifAiSources, parseTiff } from "../exif";
import { createBundle, type ParsedContainer } from "../parser/types";
import { extractXmpPacket } from "../xmp";
import {
  channelsForColorType,
  chunkLabel,
  classifyChunk,
  colorTypeHasAlpha,
  colorTypeLabel,
  parsePng,
  type PngChunk,
} from "./chunks";
import { categorizeChunk } from "./clean";
import { XMP_KEYWORD, decodeIccp, decodePngText } from "./text";

export function inspectPng(bytes: Uint8Array): ParsedContainer {
  const file = parsePng(bytes);
  const bundle = createBundle();
  const segments: MetadataSegment[] = [];
  const warnings = [...file.warnings];

  for (const chunk of file.chunks) {
    const base = classifyChunk(chunk.type);
    if (base === "structural") continue;

    const detail = describeChunk(chunk, bundle, warnings);
    segments.push({
      id: `${chunk.type}@${chunk.offset}`,
      category: categorizeChunk(chunk) === "ai" ? "ai" : base,
      container: chunk.type,
      label: chunkLabel(chunk.type),
      detail,
      offset: chunk.offset,
      size: chunk.size,
    });
  }

  for (const payload of bundle.exifPayloads) {
    try {
      const tree = parseTiff(payload);
      bundle.aiSources.push(...collectExifAiSources(tree, "PNG eXIf"));
    } catch {
      // The summary layer reports parse failures; nothing to add here.
    }
  }

  return {
    format: "png",
    container: {
      format: "png",
      width: file.width,
      height: file.height,
      colorSpace: colorTypeLabel(file.colorType),
      bitDepth: file.bitDepth,
      channels: channelsForColorType(file.colorType),
      hasAlpha: colorTypeHasAlpha(file.colorType),
      isAnimated: file.isAnimated,
      isProgressive: file.interlace === 1,
      encoding: file.isAnimated
        ? `APNG, ${file.frameCount ?? "?"} frames`
        : file.interlace === 1
          ? "Adam7 interlaced"
          : "Deflate",
    },
    segments,
    bundle,
    warnings,
    losslessSupported: true,
  };
}

function describeChunk(
  chunk: PngChunk,
  bundle: ReturnType<typeof createBundle>,
  warnings: string[],
): string | undefined {
  if (chunk.type === "eXIf") {
    bundle.exifPayloads.push(chunk.data);
    return undefined;
  }

  if (chunk.type === "caBX") {
    bundle.c2paPayloads.push(chunk.data);
    bundle.c2paLocation = "PNG caBX (JUMBF)";
    return undefined;
  }

  if (chunk.type === "iCCP") {
    const iccp = decodeIccp(chunk);
    if (iccp?.error) warnings.push(`The iCCP chunk could not be decompressed: ${iccp.error}`);
    if (iccp && iccp.profile.length > 0) bundle.iccPayloads.push(iccp.profile);
    return iccp?.name || undefined;
  }

  const decoded = decodePngText(chunk);
  if (!decoded) return undefined;
  if (decoded.error) {
    warnings.push(`The ${chunk.type} chunk "${decoded.keyword}" could not be read: ${decoded.error}`);
  }

  if (decoded.keyword === XMP_KEYWORD) {
    const packet = extractXmpPacket(new TextEncoder().encode(decoded.text));
    if (packet) {
      bundle.xmpPackets.push(packet.text);
      bundle.xmpBytes += chunk.size;
    }
    return "XMP packet";
  }

  if (decoded.text.trim()) {
    bundle.aiSources.push({
      origin: `PNG ${chunk.type}:${decoded.keyword}`,
      key: decoded.keyword,
      text: decoded.text,
      bytes: chunk.size,
    });
  }

  if (decoded.keyword.toLowerCase() === "software") {
    bundle.softwareHint = decoded.text.trim() || bundle.softwareHint;
  }

  const preview = decoded.text.trim().slice(0, 60);
  return decoded.keyword
    ? `${decoded.keyword}${preview ? `: ${preview}${decoded.text.length > 60 ? "…" : ""}` : ""}`
    : undefined;
}
