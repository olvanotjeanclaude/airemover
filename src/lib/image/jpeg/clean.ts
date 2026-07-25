import type { RemovableCategory, RemovalOptions } from "@/types/metadata";
import {
  addRemoved,
  createTally,
  switchForSegment,
  type ContainerCleanResult,
  type PreservedItem,
  type RemovalTally,
} from "../cleaner/types";
import { filterTiffTree, parseTiff, writeTiff } from "../exif";
import {
  PHOTOSHOP_RESOURCE,
  parsePhotoshopResources,
  photoshopIdentifierLength,
} from "../iptc";
import { containsAiSignature } from "../parser/ai/signals";
import { ByteWriter, bytesOfAscii, concatBytes } from "../utils/bytes";
import { decodeLatin1 } from "../utils/text";
import { extractXmpPacket, stripAiFromXmp, stripProvenanceFromXmp } from "../xmp";
import { IDENTIFIER, MARKER } from "./markers";
import type { JpegImage, JpegSegment } from "./parse";

/** JPEG segment payloads are addressed by a 16-bit length that includes itself. */
const MAX_SEGMENT_PAYLOAD = 0xffff - 2;

type Decision =
  | { action: "keep" }
  | { action: "drop"; category: RemovableCategory | null }
  | { action: "replace"; payload: Uint8Array; category: RemovableCategory | null }
  | { action: "preserve"; reason: string };

export function cleanJpeg(
  bytes: Uint8Array,
  image: JpegImage,
  options: RemovalOptions,
): ContainerCleanResult {
  const removed = createTally();
  const preserved: PreservedItem[] = [];
  const warnings: string[] = [...image.warnings];
  const output = new ByteWriter(bytes.length);

  for (const part of image.parts) {
    if (part.kind === "raw") {
      output.raw(bytes.subarray(part.offset, part.offset + part.length));
      continue;
    }

    const segment = part.segment;
    const decision = decide(segment, image, options, warnings);

    switch (decision.action) {
      case "keep":
        output.raw(bytes.subarray(segment.offset, segment.offset + segment.size));
        break;
      case "preserve":
        output.raw(bytes.subarray(segment.offset, segment.offset + segment.size));
        preserved.push({
          label: segment.label,
          bytes: segment.size,
          reason: decision.reason,
        });
        break;
      case "drop":
        if (decision.category) addRemoved(removed, decision.category, segment.size);
        break;
      case "replace": {
        const rewritten = writeSegment(segment.marker, decision.payload);
        if (rewritten.length >= segment.size) {
          // Rewriting gained nothing; keep the original bytes.
          output.raw(bytes.subarray(segment.offset, segment.offset + segment.size));
          break;
        }
        output.raw(rewritten);
        if (decision.category) {
          addRemoved(removed, decision.category, segment.size - rewritten.length);
        }
        break;
      }
    }
  }

  return {
    bytes: output.finish(),
    removed,
    preserved,
    warnings,
    pixelStreamPreserved: true,
  };
}

function writeSegment(marker: number, payload: Uint8Array): Uint8Array {
  const writer = new ByteWriter(payload.length + 4);
  writer.u8(0xff);
  writer.u8(marker);
  writer.u16(payload.length + 2);
  writer.raw(payload);
  return writer.finish();
}

function decide(
  segment: JpegSegment,
  image: JpegImage,
  options: RemovalOptions,
  warnings: string[],
): Decision {
  const category = switchForSegment(segment.category);
  if (category === null) {
    // Structural, but a JFIF header with a thumbnail is handled below.
    return { action: "keep" };
  }

  if (segment.marker === MARKER.COM) {
    const text = decodeLatin1(segment.payload);
    const isAi = containsAiSignature(text);
    const effective = isAi ? "ai" : "comment";
    return options[effective] ? { action: "drop", category: effective } : { action: "keep" };
  }

  if (segment.identifier === IDENTIFIER.ADOBE) {
    return decideAdobe(segment, image, options);
  }

  if (segment.identifier === IDENTIFIER.JFIF) {
    return decideJfif(segment, options);
  }

  if (segment.identifier === IDENTIFIER.EXIF) {
    return decideExif(segment, options, warnings);
  }

  if (segment.identifier === IDENTIFIER.XMP) {
    return decideXmp(segment, options);
  }

  if (segment.identifier === IDENTIFIER.XMP_EXTENSION) {
    if (options.xmp) return { action: "drop", category: "xmp" };
    if (options.ai || options.c2pa) {
      warnings.push(
        "Extended XMP was kept intact: it is chunked across segments and cannot be edited in place",
      );
    }
    return { action: "keep" };
  }

  if (segment.identifier === IDENTIFIER.PHOTOSHOP) {
    return decidePhotoshop(segment, options);
  }

  return options[category] ? { action: "drop", category } : { action: "keep" };
}

/**
 * The Adobe APP14 marker is not metadata in the privacy sense: its `transform`
 * byte tells the decoder how the components are encoded. Dropping it from a
 * CMYK, YCCK or RGB-coded JPEG silently changes the colours, so it only goes
 * when the default YCbCr interpretation is guaranteed to be identical.
 */
function decideAdobe(
  segment: JpegSegment,
  image: JpegImage,
  options: RemovalOptions,
): Decision {
  if (!options.other) return { action: "keep" };
  const transform = image.adobeTransform;
  const safeToDrop = image.components === 3 && transform === 1;
  if (safeToDrop) return { action: "drop", category: "other" };
  return {
    action: "preserve",
    reason:
      image.components === 4
        ? "Removing it would break CMYK/YCCK colour decoding"
        : "It declares a non-default colour transform the decoder needs",
  };
}

/** JFIF stays (it carries pixel density) but any embedded thumbnail is cut. */
function decideJfif(segment: JpegSegment, options: RemovalOptions): Decision {
  const payload = segment.payload;
  if (payload.length < 16) return { action: "keep" };
  const thumbnailWidth = payload[12];
  const thumbnailHeight = payload[13];
  if (thumbnailWidth === 0 || thumbnailHeight === 0) return { action: "keep" };
  if (!options.other) return { action: "keep" };

  const trimmed = payload.slice(0, 14);
  trimmed[12] = 0;
  trimmed[13] = 0;
  return { action: "replace", payload: trimmed, category: "other" };
}

function decideExif(
  segment: JpegSegment,
  options: RemovalOptions,
  warnings: string[],
): Decision {
  if (options.exif) return { action: "drop", category: "exif" };

  const header = IDENTIFIER.EXIF.length;
  const tiffPayload = segment.payload.subarray(header);
  if (tiffPayload.length < 8) return { action: "keep" };

  try {
    const tree = parseTiff(tiffPayload);
    const outcome = filterTiffTree(tree, options, "embedded");
    if (!outcome.changed) return { action: "keep" };
    if (!outcome.tree) return { action: "drop", category: "exif" };

    const rebuilt = writeTiff(outcome.tree);
    const payload = concatBytes([bytesOfAscii(IDENTIFIER.EXIF), rebuilt]);
    if (payload.length > MAX_SEGMENT_PAYLOAD) {
      warnings.push("Rewritten EXIF exceeded the JPEG segment limit and was removed instead");
      return { action: "drop", category: "exif" };
    }
    const category = dominantCategory(outcome.removed);
    return { action: "replace", payload, category };
  } catch (error) {
    warnings.push(
      `EXIF could not be rewritten (${describeError(error)}); the whole block was removed`,
    );
    return { action: "drop", category: "exif" };
  }
}

function decideXmp(segment: JpegSegment, options: RemovalOptions): Decision {
  if (options.xmp) return { action: "drop", category: "xmp" };
  if (!options.ai && !options.c2pa) return { action: "keep" };

  const header = IDENTIFIER.XMP.length;
  const packet = extractXmpPacket(segment.payload.subarray(header));
  if (!packet) return { action: "keep" };

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
  if (!category) return { action: "keep" };

  const payload = concatBytes([
    bytesOfAscii(IDENTIFIER.XMP),
    new TextEncoder().encode(text),
  ]);
  return { action: "replace", payload, category };
}

/**
 * APP13 is a container of 8BIM resources, each of which maps to a different
 * switch. Dropping only the selected resources means "remove IPTC but keep the
 * colour settings" does exactly that.
 */
function decidePhotoshop(segment: JpegSegment, options: RemovalOptions): Decision {
  const headerLength = photoshopIdentifierLength(segment.payload);
  if (headerLength === 0) {
    return options.iptc ? { action: "drop", category: "iptc" } : { action: "keep" };
  }

  const body = segment.payload.subarray(headerLength);
  const resources = parsePhotoshopResources(body);
  if (resources.length === 0) {
    return options.iptc ? { action: "drop", category: "iptc" } : { action: "keep" };
  }

  const kept: typeof resources = [];
  let removedAny = false;
  let firstRemoved: RemovableCategory | null = null;

  for (const resource of resources) {
    const category = photoshopResourceCategory(resource.id);
    if (category && options[category]) {
      removedAny = true;
      firstRemoved = firstRemoved ?? category;
      continue;
    }
    kept.push(resource);
  }

  if (!removedAny) return { action: "keep" };
  if (kept.length === 0) {
    return { action: "drop", category: firstRemoved ?? "iptc" };
  }

  const rebuilt = new ByteWriter(body.length);
  rebuilt.raw(bytesOfAscii(IDENTIFIER.PHOTOSHOP));
  for (const resource of kept) {
    rebuilt.ascii("8BIM");
    rebuilt.u16(resource.id);
    // Empty Pascal string: a single length byte of zero, padded to even.
    rebuilt.u8(0);
    rebuilt.u8(0);
    rebuilt.u32(resource.data.length);
    rebuilt.raw(resource.data);
    if (resource.data.length % 2 === 1) rebuilt.u8(0);
  }

  return { action: "replace", payload: rebuilt.finish(), category: firstRemoved };
}

function photoshopResourceCategory(
  id: number,
): RemovableCategory | null {
  switch (id) {
    case PHOTOSHOP_RESOURCE.IptcNaa:
    case PHOTOSHOP_RESOURCE.CaptionDigest:
      return "iptc";
    case PHOTOSHOP_RESOURCE.Xmp:
      return "xmp";
    case PHOTOSHOP_RESOURCE.ExifData1:
    case PHOTOSHOP_RESOURCE.ExifData3:
      return "exif";
    case PHOTOSHOP_RESOURCE.IccProfile:
      return "icc";
    default:
      return "other";
  }
}

function dominantCategory(
  removed: Map<RemovableCategory, RemovalTally>,
): RemovableCategory {
  let best: RemovableCategory | null = null;
  let bestBytes = -1;
  for (const [category, tally] of removed) {
    if (tally.bytes > bestBytes) {
      bestBytes = tally.bytes;
      best = category;
    }
  }
  return best ?? "exif";
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
