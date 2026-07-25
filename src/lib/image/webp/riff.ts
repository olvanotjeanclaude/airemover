import type { SegmentCategory } from "@/types/metadata";
import { ByteReader } from "../utils/bytes";

export class WebpParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebpParseError";
  }
}

export interface RiffChunk {
  fourCc: string;
  /** Offset of the FourCC. */
  offset: number;
  /** Payload length as declared, excluding the pad byte. */
  size: number;
  /** Total bytes consumed: 8 header + payload + optional pad. */
  totalSize: number;
  payload: Uint8Array;
}

export const VP8X_FLAG = {
  Animation: 0x02,
  Xmp: 0x04,
  Exif: 0x08,
  Alpha: 0x10,
  Icc: 0x20,
} as const;

export interface WebpFile {
  chunks: RiffChunk[];
  width?: number;
  height?: number;
  hasAlpha: boolean;
  isAnimated: boolean;
  isLossless: boolean;
  /** True when the file uses the extended (VP8X) layout. */
  extended: boolean;
  vp8xFlags: number;
  frameCount: number;
  encoding: string;
  warnings: string[];
}

const IMAGE_CHUNKS = new Set(["VP8 ", "VP8L", "VP8X", "ALPH", "ANIM", "ANMF"]);

export function classifyRiffChunk(fourCc: string): SegmentCategory {
  if (IMAGE_CHUNKS.has(fourCc)) return "structural";
  if (fourCc === "EXIF") return "exif";
  if (fourCc === "XMP ") return "xmp";
  if (fourCc === "ICCP") return "icc";
  if (fourCc === "C2PA") return "c2pa";
  return "other";
}

export function riffChunkLabel(fourCc: string): string {
  switch (fourCc) {
    case "VP8 ":
      return "VP8 image data";
    case "VP8L":
      return "VP8L image data";
    case "VP8X":
      return "Extended format header";
    case "ALPH":
      return "Alpha channel";
    case "ANIM":
      return "Animation parameters";
    case "ANMF":
      return "Animation frame";
    case "EXIF":
      return "EXIF";
    case "XMP ":
      return "XMP";
    case "ICCP":
      return "ICC colour profile";
    case "C2PA":
      return "C2PA manifest (JUMBF)";
    default:
      return `${fourCc.trim()} chunk`;
  }
}

export function parseWebp(bytes: Uint8Array): WebpFile {
  if (bytes.length < 12) throw new WebpParseError("File is too short to be a RIFF container");
  const reader = new ByteReader(bytes);
  if (reader.ascii(4) !== "RIFF") throw new WebpParseError("Missing RIFF header");
  const riffSize = reader.u32(true);
  if (reader.ascii(4) !== "WEBP") throw new WebpParseError("RIFF container is not WebP");

  const warnings: string[] = [];
  const declaredEnd = Math.min(bytes.length, riffSize + 8);
  if (riffSize + 8 > bytes.length) {
    warnings.push(
      `The RIFF header declares ${riffSize + 8} bytes but the file holds ${bytes.length}`,
    );
  } else if (riffSize + 8 < bytes.length) {
    warnings.push(`${bytes.length - riffSize - 8} trailing byte(s) after the RIFF chunk were discarded`);
  }

  const chunks: RiffChunk[] = [];
  while (reader.offset + 8 <= declaredEnd) {
    const offset = reader.offset;
    const fourCc = reader.ascii(4);
    const size = reader.u32(true);
    if (reader.offset + size > bytes.length) {
      warnings.push(`Chunk ${fourCc} at ${offset} declares ${size} bytes and was dropped`);
      break;
    }
    const payload = reader.take(size);
    let totalSize = 8 + size;
    if (size % 2 === 1) {
      if (reader.has(1)) {
        reader.skip(1);
        totalSize += 1;
      }
    }
    chunks.push({ fourCc, offset, size, totalSize, payload });
  }

  if (chunks.length === 0) throw new WebpParseError("WebP container holds no chunks");

  const file: WebpFile = {
    chunks,
    hasAlpha: false,
    isAnimated: false,
    isLossless: false,
    extended: false,
    vp8xFlags: 0,
    frameCount: 0,
    encoding: "Unknown",
    warnings,
  };

  readGeometry(file, chunks);
  return file;
}

function readGeometry(file: WebpFile, chunks: readonly RiffChunk[]): void {
  const vp8x = chunks.find((chunk) => chunk.fourCc === "VP8X");
  if (vp8x && vp8x.payload.length >= 10) {
    file.extended = true;
    file.vp8xFlags = vp8x.payload[0];
    file.hasAlpha = (file.vp8xFlags & VP8X_FLAG.Alpha) !== 0;
    file.isAnimated = (file.vp8xFlags & VP8X_FLAG.Animation) !== 0;
    const view = vp8x.payload;
    file.width = 1 + (view[4] | (view[5] << 8) | (view[6] << 16));
    file.height = 1 + (view[7] | (view[8] << 8) | (view[9] << 16));
  }

  file.frameCount = chunks.filter((chunk) => chunk.fourCc === "ANMF").length;

  const lossy = chunks.find((chunk) => chunk.fourCc === "VP8 ");
  const lossless = chunks.find((chunk) => chunk.fourCc === "VP8L");

  if (lossless) {
    file.isLossless = true;
    file.encoding = "VP8L (lossless)";
    if (!file.extended && lossless.payload.length >= 5 && lossless.payload[0] === 0x2f) {
      const bits =
        lossless.payload[1] |
        (lossless.payload[2] << 8) |
        (lossless.payload[3] << 16) |
        (lossless.payload[4] << 24);
      file.width = (bits & 0x3fff) + 1;
      file.height = ((bits >>> 14) & 0x3fff) + 1;
      file.hasAlpha = ((bits >>> 28) & 1) === 1;
    }
    return;
  }

  if (lossy) {
    file.encoding = "VP8 (lossy)";
    if (!file.extended && lossy.payload.length >= 10) {
      // Key frame header: 3 bytes frame tag, then the 0x9d012a start code.
      if (lossy.payload[3] === 0x9d && lossy.payload[4] === 0x01 && lossy.payload[5] === 0x2a) {
        file.width = ((lossy.payload[7] << 8) | lossy.payload[6]) & 0x3fff;
        file.height = ((lossy.payload[9] << 8) | lossy.payload[8]) & 0x3fff;
      }
    }
    if (chunks.some((chunk) => chunk.fourCc === "ALPH")) file.hasAlpha = true;
    return;
  }

  if (file.isAnimated) {
    file.encoding = `Animated, ${file.frameCount} frame(s)`;
  }
}
