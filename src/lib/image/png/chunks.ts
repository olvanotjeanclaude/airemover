import type { SegmentCategory } from "@/types/metadata";
import { ByteReader, asciiOf } from "../utils/bytes";
import { crc32 } from "../utils/crc32";

export class PngParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PngParseError";
  }
}

export const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

export interface PngChunk {
  type: string;
  /** Offset of the 4-byte length field. */
  offset: number;
  /** Total bytes: length (4) + type (4) + data + CRC (4). */
  size: number;
  data: Uint8Array;
  declaredCrc: number;
  crcValid: boolean;
  /** Uppercase first letter: the decoder must understand it. */
  critical: boolean;
}

export function hasPngSignature(bytes: Uint8Array): boolean {
  if (bytes.length < PNG_SIGNATURE.length) return false;
  for (let index = 0; index < PNG_SIGNATURE.length; index += 1) {
    if (bytes[index] !== PNG_SIGNATURE[index]) return false;
  }
  return true;
}

/** Chunks the decoder needs, or that materially change how pixels look. */
const FUNCTIONAL_CHUNKS = new Set([
  "IHDR",
  "PLTE",
  "IDAT",
  "IEND",
  "tRNS",
  "gAMA",
  "cHRM",
  "sRGB",
  "sBIT",
  "bKGD",
  "hIST",
  "pHYs",
  "sPLT",
  "cICP",
  "mDCv",
  "cLLi",
  // APNG animation control.
  "acTL",
  "fcTL",
  "fdAT",
  // JNG / MNG interop chunks that carry image data.
  "JHDR",
  "JDAT",
]);

const TEXT_CHUNKS = new Set(["tEXt", "zTXt", "iTXt"]);

export function isTextChunk(type: string): boolean {
  return TEXT_CHUNKS.has(type);
}

export function classifyChunk(type: string): SegmentCategory {
  if (FUNCTIONAL_CHUNKS.has(type)) return "structural";
  if (type === "iCCP") return "icc";
  if (type === "eXIf") return "exif";
  if (type === "caBX") return "c2pa";
  if (TEXT_CHUNKS.has(type)) return "comment";
  if (type === "tIME") return "other";
  return "other";
}

export function chunkLabel(type: string): string {
  switch (type) {
    case "IHDR":
      return "Image header";
    case "PLTE":
      return "Palette";
    case "IDAT":
      return "Image data";
    case "IEND":
      return "End of image";
    case "iCCP":
      return "ICC colour profile";
    case "eXIf":
      return "EXIF";
    case "caBX":
      return "C2PA manifest (JUMBF)";
    case "tEXt":
      return "Text (uncompressed)";
    case "zTXt":
      return "Text (compressed)";
    case "iTXt":
      return "Text (international)";
    case "tIME":
      return "Last modification time";
    case "acTL":
      return "Animation control";
    case "fcTL":
      return "Frame control";
    case "fdAT":
      return "Frame data";
    default:
      return `${type} chunk`;
  }
}

export interface PngFile {
  chunks: PngChunk[];
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  interlace: number;
  isAnimated: boolean;
  frameCount?: number;
  warnings: string[];
  /** Bytes after IEND, which are not part of the image. */
  trailingBytes: number;
}

const COLOR_TYPE_LABELS: Readonly<Record<number, string>> = {
  0: "Grayscale",
  2: "RGB",
  3: "Indexed",
  4: "Grayscale + alpha",
  6: "RGB + alpha",
};

export function colorTypeLabel(colorType: number): string {
  return COLOR_TYPE_LABELS[colorType] ?? `Colour type ${colorType}`;
}

export function colorTypeHasAlpha(colorType: number): boolean {
  return colorType === 4 || colorType === 6;
}

export function channelsForColorType(colorType: number): number {
  switch (colorType) {
    case 0:
      return 1;
    case 2:
      return 3;
    case 3:
      return 1;
    case 4:
      return 2;
    case 6:
      return 4;
    default:
      return 1;
  }
}

export function parsePng(bytes: Uint8Array): PngFile {
  if (!hasPngSignature(bytes)) {
    throw new PngParseError("Missing PNG signature");
  }

  const chunks: PngChunk[] = [];
  const warnings: string[] = [];
  const reader = new ByteReader(bytes, PNG_SIGNATURE.length);
  let sawIend = false;
  let trailingBytes = 0;
  let frameCount: number | undefined;

  while (reader.has(8)) {
    const offset = reader.offset;
    const length = reader.u32();
    if (length > bytes.length) {
      warnings.push(`Chunk at ${offset} declares ${length} bytes and was ignored`);
      break;
    }
    const typeBytes = reader.peek(4);
    const type = asciiOf(typeBytes);
    reader.skip(4);

    if (!reader.has(length + 4)) {
      warnings.push(`Chunk ${type} at ${offset} is truncated and was dropped`);
      break;
    }

    const data = reader.take(length);
    const declaredCrc = reader.u32();
    const computed = crc32(typeBytes, data);
    const crcValid = computed === declaredCrc;
    if (!crcValid) {
      warnings.push(`Chunk ${type} at ${offset} has a bad CRC and may be corrupt`);
    }

    chunks.push({
      type,
      offset,
      size: reader.offset - offset,
      data,
      declaredCrc,
      crcValid,
      critical: type.charCodeAt(0) >= 65 && type.charCodeAt(0) <= 90,
    });

    if (type === "acTL" && data.length >= 8) {
      frameCount = (data[0] << 24) | (data[1] << 16) | (data[2] << 8) | data[3];
    }

    if (type === "IEND") {
      sawIend = true;
      trailingBytes = bytes.length - reader.offset;
      break;
    }
  }

  const header = chunks.find((chunk) => chunk.type === "IHDR");
  if (!header || header.data.length < 13) {
    throw new PngParseError("PNG is missing a usable IHDR chunk");
  }
  if (!sawIend) {
    warnings.push("No IEND chunk was found; the file may be truncated");
  }
  if (trailingBytes > 0) {
    warnings.push(`${trailingBytes} byte(s) follow IEND and were discarded`);
  }

  const view = new DataView(
    header.data.buffer,
    header.data.byteOffset,
    header.data.byteLength,
  );

  return {
    chunks,
    width: view.getUint32(0),
    height: view.getUint32(4),
    bitDepth: header.data[8],
    colorType: header.data[9],
    interlace: header.data[12],
    isAnimated: chunks.some((chunk) => chunk.type === "acTL"),
    frameCount,
    warnings,
    trailingBytes,
  };
}
