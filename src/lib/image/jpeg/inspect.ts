import type { MetadataSegment } from "@/types/metadata";
import { createBundle, type MetadataBundle, type ParsedContainer } from "../parser/types";
import { collectExifAiSources, parseTiff } from "../exif";
import {
  PHOTOSHOP_RESOURCE,
  parsePhotoshopResources,
  photoshopIdentifierLength,
} from "../iptc";
import { concatBytes } from "../utils/bytes";
import { decodeLatin1 } from "../utils/text";
import { extractXmpPacket } from "../xmp";
import { IDENTIFIER, MARKER } from "./markers";
import { jpegColorSpace, parseJpeg, type JpegImage, type JpegSegment } from "./parse";

/** ICC profiles above 64 KB are split across APP2 markers and must be rejoined. */
const ICC_CHUNK_HEADER = IDENTIFIER.ICC.length + 2;

export function inspectJpeg(bytes: Uint8Array): ParsedContainer {
  const image = parseJpeg(bytes);
  const bundle = createBundle();
  const segments: MetadataSegment[] = [];
  const warnings = [...image.warnings];
  const iccChunks: Uint8Array[] = [];

  for (const segment of image.segments) {
    segments.push(toMetadataSegment(segment, image));
    collect(segment, bundle, iccChunks, warnings);
  }

  if (iccChunks.length > 0) bundle.iccPayloads.push(concatBytes(iccChunks));

  for (const payload of bundle.exifPayloads) {
    try {
      const tree = parseTiff(payload);
      bundle.aiSources.push(...collectExifAiSources(tree, "JPEG EXIF"));
    } catch {
      // Summaries handle the failure; AI extraction is best-effort here.
    }
  }

  for (const packet of bundle.xmpPackets) {
    bundle.aiSources.push({
      origin: "JPEG XMP",
      key: "xmp",
      text: packet,
      bytes: packet.length,
    });
  }

  return {
    format: "jpeg",
    container: {
      format: "jpeg",
      width: image.width,
      height: image.height,
      colorSpace: jpegColorSpace(image),
      bitDepth: image.precision,
      channels: image.components,
      hasAlpha: false,
      isAnimated: false,
      isProgressive: image.progressive,
      encoding: image.frameLabel,
    },
    segments,
    bundle,
    warnings,
    losslessSupported: true,
  };
}

function toMetadataSegment(segment: JpegSegment, image: JpegImage): MetadataSegment {
  const preservedReason =
    segment.identifier === IDENTIFIER.ADOBE && !(image.components === 3 && image.adobeTransform === 1)
      ? "Required for correct colour decoding"
      : undefined;

  return {
    id: `${segment.name}@${segment.offset}`,
    category: segment.category,
    container: segment.name,
    label: segment.label,
    detail: segment.detail,
    offset: segment.offset,
    size: segment.size,
    preservedReason,
  };
}

function collect(
  segment: JpegSegment,
  bundle: MetadataBundle,
  iccChunks: Uint8Array[],
  warnings: string[],
): void {
  if (segment.marker === MARKER.COM) {
    const text = decodeLatin1(segment.payload);
    if (text.trim()) {
      bundle.aiSources.push({
        origin: "JPEG COM",
        key: "comment",
        text,
        bytes: segment.payload.length,
      });
    }
    return;
  }

  switch (segment.identifier) {
    case IDENTIFIER.EXIF: {
      const payload = segment.payload.subarray(IDENTIFIER.EXIF.length);
      if (payload.length >= 8) bundle.exifPayloads.push(payload);
      else warnings.push("The EXIF segment is too short to contain a TIFF header");
      return;
    }
    case IDENTIFIER.XMP: {
      const packet = extractXmpPacket(segment.payload.subarray(IDENTIFIER.XMP.length));
      if (packet) {
        bundle.xmpPackets.push(packet.text);
        bundle.xmpBytes += segment.size;
      }
      return;
    }
    case IDENTIFIER.XMP_EXTENSION:
      bundle.xmpBytes += segment.size;
      return;
    case IDENTIFIER.ICC: {
      if (segment.payload.length > ICC_CHUNK_HEADER) {
        iccChunks.push(segment.payload.subarray(ICC_CHUNK_HEADER));
      }
      return;
    }
    case IDENTIFIER.JUMBF: {
      // 'JP' + box instance number (2) + packet sequence number (4).
      const boxes = segment.payload.subarray(8);
      if (boxes.length > 0) {
        bundle.c2paPayloads.push(boxes);
        bundle.c2paLocation = "JPEG APP11 (JUMBF)";
      }
      return;
    }
    case IDENTIFIER.PHOTOSHOP: {
      const headerLength = photoshopIdentifierLength(segment.payload);
      if (headerLength === 0) return;
      for (const resource of parsePhotoshopResources(segment.payload.subarray(headerLength))) {
        if (resource.id === PHOTOSHOP_RESOURCE.IptcNaa) {
          bundle.iptcPayloads.push(resource.data);
        } else if (resource.id === PHOTOSHOP_RESOURCE.Xmp) {
          const packet = extractXmpPacket(resource.data);
          if (packet) {
            bundle.xmpPackets.push(packet.text);
            bundle.xmpBytes += resource.data.length;
          }
        } else if (resource.id === PHOTOSHOP_RESOURCE.IccProfile) {
          bundle.iccPayloads.push(resource.data);
        }
      }
      return;
    }
    default:
      return;
  }
}
