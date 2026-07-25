import type { SegmentCategory } from "@/types/metadata";
import { asciiOf, startsWithAscii } from "../utils/bytes";
import { looksLikeJumbf } from "../c2pa";
import {
  IDENTIFIER,
  MARKER,
  frameName,
  isAppMarker,
  isArithmeticFrame,
  isFrameMarker,
  isLosslessFrame,
  isProgressiveFrame,
  isStandaloneMarker,
  markerName,
} from "./markers";

export class JpegParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JpegParseError";
  }
}

export interface JpegSegment {
  marker: number;
  /** "APP1", "COM", ... */
  name: string;
  /** Offset of the leading 0xFF byte. */
  offset: number;
  /** Total bytes: marker (2) + length field (2) + payload. */
  size: number;
  payload: Uint8Array;
  payloadOffset: number;
  /** NUL-terminated identifier string when the segment declares one. */
  identifier?: string;
  category: SegmentCategory;
  label: string;
  detail?: string;
}

/**
 * A JPEG is modelled as an ordered list of parts. `raw` runs cover SOI, the
 * frame headers, every entropy-coded scan and any trailing bytes, and are
 * copied verbatim. Only `segment` parts are ever candidates for removal, which
 * is what guarantees the compressed image stream survives untouched.
 */
export type JpegPart =
  | { kind: "raw"; offset: number; length: number }
  | { kind: "segment"; segment: JpegSegment };

export interface JpegImage {
  parts: JpegPart[];
  segments: JpegSegment[];
  width?: number;
  height?: number;
  precision?: number;
  components?: number;
  frameLabel?: string;
  progressive: boolean;
  lossless: boolean;
  arithmetic: boolean;
  /** Adobe APP14 colour transform, when the marker is present. */
  adobeTransform?: number;
  restartInterval?: number;
  warnings: string[];
}

export function parseJpeg(bytes: Uint8Array): JpegImage {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new JpegParseError("Missing JPEG start-of-image marker");
  }

  const parts: JpegPart[] = [];
  const segments: JpegSegment[] = [];
  const warnings: string[] = [];
  const image: JpegImage = {
    parts,
    segments,
    progressive: false,
    lossless: false,
    arithmetic: false,
    warnings,
  };

  let rawStart = 0;
  let cursor = 2;
  let sawEoi = false;

  const flushRaw = (until: number): void => {
    if (until > rawStart) {
      const previous = parts[parts.length - 1];
      if (previous?.kind === "raw" && previous.offset + previous.length === rawStart) {
        previous.length += until - rawStart;
      } else {
        parts.push({ kind: "raw", offset: rawStart, length: until - rawStart });
      }
    }
    rawStart = until;
  };

  while (cursor < bytes.length) {
    if (bytes[cursor] !== 0xff) {
      // Stray data between segments. Resynchronise on the next marker prefix.
      const next = findNextMarker(bytes, cursor);
      if (next < 0) break;
      if (next > cursor) {
        warnings.push(`Skipped ${next - cursor} unexpected byte(s) at offset ${cursor}`);
        cursor = next;
        continue;
      }
    }

    const markerStart = cursor;
    let scan = cursor + 1;
    while (scan < bytes.length && bytes[scan] === 0xff) scan += 1; // fill bytes
    if (scan >= bytes.length) break;
    const marker = bytes[scan];
    cursor = scan + 1;

    if (marker === 0x00) {
      // Stuffed byte outside a scan; treat as data.
      continue;
    }

    if (isStandaloneMarker(marker)) {
      if (marker === MARKER.EOI) {
        sawEoi = true;
        flushRaw(cursor);
        if (cursor < bytes.length) {
          parts.push({ kind: "raw", offset: cursor, length: bytes.length - cursor });
          warnings.push(
            `${bytes.length - cursor} byte(s) follow the end-of-image marker and were kept`,
          );
          rawStart = bytes.length;
        }
        break;
      }
      continue;
    }

    if (cursor + 2 > bytes.length) {
      warnings.push(`Segment ${markerName(marker)} is truncated at offset ${markerStart}`);
      break;
    }
    const length = (bytes[cursor] << 8) | bytes[cursor + 1];
    if (length < 2) {
      warnings.push(
        `Segment ${markerName(marker)} declares an invalid length (${length})`,
      );
      break;
    }
    const payloadOffset = cursor + 2;
    const payloadEnd = cursor + length;
    if (payloadEnd > bytes.length) {
      warnings.push(
        `Segment ${markerName(marker)} at ${markerStart} extends past the end of the file`,
      );
      break;
    }

    if (isFrameMarker(marker)) {
      readFrame(image, bytes, payloadOffset, payloadEnd, marker);
      cursor = payloadEnd;
      continue;
    }

    if (marker === MARKER.DRI && payloadEnd - payloadOffset >= 2) {
      image.restartInterval = (bytes[payloadOffset] << 8) | bytes[payloadOffset + 1];
      cursor = payloadEnd;
      continue;
    }

    if (marker === MARKER.SOS) {
      cursor = skipEntropyCodedData(bytes, payloadEnd);
      continue;
    }

    if (isAppMarker(marker) || marker === MARKER.COM) {
      const payload = bytes.subarray(payloadOffset, payloadEnd);
      const segment = describeSegment(
        marker,
        markerStart,
        payloadEnd - markerStart,
        payload,
        payloadOffset,
      );
      if (segment.identifier === IDENTIFIER.ADOBE && payload.length >= 12) {
        image.adobeTransform = payload[11];
      }
      flushRaw(markerStart);
      parts.push({ kind: "segment", segment });
      segments.push(segment);
      rawStart = payloadEnd;
      cursor = payloadEnd;
      continue;
    }

    // DQT, DHT, DAC, DNL, EXP and friends: structural, kept verbatim.
    cursor = payloadEnd;
  }

  if (!sawEoi) {
    warnings.push("No end-of-image marker was found; the file may be truncated");
  }
  // Anything not already emitted (a trailing scan, a truncated tail) is raw.
  flushRaw(bytes.length);

  if (image.width === undefined) {
    warnings.push("No start-of-frame marker was found; dimensions are unknown");
  }

  return image;
}

function findNextMarker(bytes: Uint8Array, from: number): number {
  for (let index = from; index < bytes.length - 1; index += 1) {
    if (bytes[index] === 0xff && bytes[index + 1] !== 0x00) return index;
  }
  return -1;
}

/**
 * Walks past an entropy-coded scan. Inside the scan a 0xFF byte is either
 * followed by 0x00 (a stuffed byte) or is a restart marker; anything else ends
 * the scan.
 */
function skipEntropyCodedData(bytes: Uint8Array, from: number): number {
  let index = from;
  while (index < bytes.length - 1) {
    if (bytes[index] !== 0xff) {
      index += 1;
      continue;
    }
    const next = bytes[index + 1];
    if (next === 0x00 || next === 0xff || (next >= 0xd0 && next <= 0xd7)) {
      index += 2;
      continue;
    }
    return index;
  }
  return bytes.length;
}

function readFrame(
  image: JpegImage,
  bytes: Uint8Array,
  payloadOffset: number,
  payloadEnd: number,
  marker: number,
): void {
  if (payloadEnd - payloadOffset < 6) {
    image.warnings.push("Start-of-frame header is too short to read");
    return;
  }
  image.precision = bytes[payloadOffset];
  image.height = (bytes[payloadOffset + 1] << 8) | bytes[payloadOffset + 2];
  image.width = (bytes[payloadOffset + 3] << 8) | bytes[payloadOffset + 4];
  image.components = bytes[payloadOffset + 5];
  image.frameLabel = frameName(marker);
  image.progressive = isProgressiveFrame(marker);
  image.lossless = isLosslessFrame(marker);
  image.arithmetic = isArithmeticFrame(marker);
}

function readIdentifier(payload: Uint8Array, maxLength = 40): string | undefined {
  const limit = Math.min(payload.length, maxLength);
  for (let index = 0; index < limit; index += 1) {
    if (payload[index] === 0) return asciiOf(payload.subarray(0, index + 1));
  }
  return undefined;
}

interface SegmentClassification {
  category: SegmentCategory;
  label: string;
  detail?: string;
  identifier?: string;
}

function classify(marker: number, payload: Uint8Array): SegmentClassification {
  const identifier = readIdentifier(payload);

  if (marker === MARKER.COM) {
    return { category: "comment", label: "JPEG comment", identifier: undefined };
  }

  if (marker === MARKER.APP0) {
    if (startsWithAscii(payload, IDENTIFIER.JFIF)) {
      const hasThumbnail =
        payload.length >= 16 && payload[12] !== 0 && payload[13] !== 0;
      return {
        category: hasThumbnail ? "thumbnail" : "structural",
        label: "JFIF header",
        detail: hasThumbnail
          ? `Embedded ${payload[12]}x${payload[13]} thumbnail`
          : "Pixel density and version",
        identifier: IDENTIFIER.JFIF,
      };
    }
    if (startsWithAscii(payload, IDENTIFIER.JFXX)) {
      return {
        category: "thumbnail",
        label: "JFIF extension thumbnail",
        identifier: IDENTIFIER.JFXX,
      };
    }
    return { category: "other", label: "APP0 (unrecognised)", identifier };
  }

  if (marker === MARKER.APP1) {
    if (startsWithAscii(payload, IDENTIFIER.EXIF)) {
      return { category: "exif", label: "EXIF", identifier: IDENTIFIER.EXIF };
    }
    if (startsWithAscii(payload, IDENTIFIER.XMP)) {
      return { category: "xmp", label: "XMP", identifier: IDENTIFIER.XMP };
    }
    if (startsWithAscii(payload, IDENTIFIER.XMP_EXTENSION)) {
      return {
        category: "xmp",
        label: "XMP (extended)",
        identifier: IDENTIFIER.XMP_EXTENSION,
      };
    }
    return { category: "other", label: "APP1 (unrecognised)", identifier };
  }

  if (marker === MARKER.APP2) {
    if (startsWithAscii(payload, IDENTIFIER.ICC)) {
      const chunk = payload.length > 13 ? payload[12] : 1;
      const total = payload.length > 13 ? payload[13] : 1;
      return {
        category: "icc",
        label: "ICC colour profile",
        detail: total > 1 ? `Chunk ${chunk} of ${total}` : undefined,
        identifier: IDENTIFIER.ICC,
      };
    }
    if (startsWithAscii(payload, IDENTIFIER.MPF)) {
      return {
        category: "other",
        label: "Multi-picture format index",
        identifier: IDENTIFIER.MPF,
      };
    }
    if (startsWithAscii(payload, IDENTIFIER.FPXR)) {
      return { category: "other", label: "FlashPix data", identifier: IDENTIFIER.FPXR };
    }
    return { category: "other", label: "APP2 (unrecognised)", identifier };
  }

  if (marker === MARKER.APP11) {
    if (startsWithAscii(payload, IDENTIFIER.JUMBF)) {
      // 'JP' + box instance (2) + packet sequence (4), then the JUMBF boxes.
      const boxes = payload.subarray(8);
      if (looksLikeJumbf(boxes) || looksLikeJumbf(payload.subarray(2))) {
        return {
          category: "c2pa",
          label: "C2PA manifest (JUMBF)",
          identifier: IDENTIFIER.JUMBF,
        };
      }
      return { category: "other", label: "JPEG universal box", identifier: IDENTIFIER.JUMBF };
    }
    return { category: "other", label: "APP11 (unrecognised)", identifier };
  }

  if (marker === MARKER.APP13) {
    if (startsWithAscii(payload, IDENTIFIER.PHOTOSHOP)) {
      return {
        category: "iptc",
        label: "Photoshop / IPTC resources",
        identifier: IDENTIFIER.PHOTOSHOP,
      };
    }
    return { category: "other", label: "APP13 (unrecognised)", identifier };
  }

  if (marker === MARKER.APP14) {
    if (startsWithAscii(payload, IDENTIFIER.ADOBE)) {
      const transform = payload.length >= 12 ? payload[11] : undefined;
      return {
        category: "other",
        label: "Adobe colour transform",
        detail:
          transform === undefined
            ? undefined
            : `Transform ${transform} (${transformName(transform)})`,
        identifier: IDENTIFIER.ADOBE,
      };
    }
    return { category: "other", label: "APP14 (unrecognised)", identifier };
  }

  if (isAppMarker(marker)) {
    return {
      category: "other",
      label: `${markerName(marker)}${identifier ? ` (${identifier.replace(/\0/g, "")})` : ""}`,
      identifier,
    };
  }

  return { category: "other", label: markerName(marker), identifier };
}

function transformName(transform: number): string {
  if (transform === 0) return "no transform, RGB or CMYK";
  if (transform === 1) return "YCbCr";
  if (transform === 2) return "YCCK";
  return "unknown";
}

function describeSegment(
  marker: number,
  offset: number,
  size: number,
  payload: Uint8Array,
  payloadOffset: number,
): JpegSegment {
  const classification = classify(marker, payload);
  return {
    marker,
    name: markerName(marker),
    offset,
    size,
    payload,
    payloadOffset,
    identifier: classification.identifier,
    category: classification.category,
    label: classification.label,
    detail: classification.detail,
  };
}

/** Colour space implied by the frame header and the Adobe marker. */
export function jpegColorSpace(image: JpegImage): string | undefined {
  const components = image.components;
  if (components === 1) return "Grayscale";
  if (components === 3) {
    if (image.adobeTransform === 0) return "RGB";
    return "YCbCr";
  }
  if (components === 4) {
    return image.adobeTransform === 2 ? "YCCK" : "CMYK";
  }
  return undefined;
}
