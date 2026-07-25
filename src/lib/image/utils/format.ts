import type { FormatDescriptor, ImageFormat } from "@/types/image";
import { asciiOf, startsWithAscii } from "./bytes";

export const FORMAT_DESCRIPTORS: Record<ImageFormat, FormatDescriptor> = {
  jpeg: { format: "jpeg", extension: "jpg", mimeType: "image/jpeg", label: "JPEG" },
  png: { format: "png", extension: "png", mimeType: "image/png", label: "PNG" },
  webp: { format: "webp", extension: "webp", mimeType: "image/webp", label: "WebP" },
  avif: { format: "avif", extension: "avif", mimeType: "image/avif", label: "AVIF" },
  heic: { format: "heic", extension: "heic", mimeType: "image/heic", label: "HEIC" },
  tiff: { format: "tiff", extension: "tiff", mimeType: "image/tiff", label: "TIFF" },
  gif: { format: "gif", extension: "gif", mimeType: "image/gif", label: "GIF" },
  bmp: { format: "bmp", extension: "bmp", mimeType: "image/bmp", label: "BMP" },
  unknown: {
    format: "unknown",
    extension: "bin",
    mimeType: "application/octet-stream",
    label: "Unknown",
  },
};

/** HEIF brand codes that mean "still image", as opposed to AVIF or sequences. */
const HEIC_BRANDS = new Set([
  "heic",
  "heix",
  "heim",
  "heis",
  "hevc",
  "hevx",
  "mif1",
  "msf1",
]);

const AVIF_BRANDS = new Set(["avif", "avis", "av01"]);

/**
 * Identifies the container from its magic bytes only. The file extension and
 * the browser-reported MIME type are both untrusted here: a `.png` that is
 * really a JPEG must be cleaned as a JPEG.
 */
export function detectFormat(bytes: Uint8Array): ImageFormat {
  if (bytes.length < 12) return "unknown";

  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";

  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "png";
  }

  if (startsWithAscii(bytes, "RIFF") && startsWithAscii(bytes, "WEBP", 8)) {
    return "webp";
  }

  if (startsWithAscii(bytes, "ftyp", 4)) {
    const majorBrand = asciiOf(bytes.subarray(8, 12));
    if (AVIF_BRANDS.has(majorBrand)) return "avif";
    if (HEIC_BRANDS.has(majorBrand)) return "heic";
    // Fall back to the compatible-brand list when the major brand is generic.
    const compatible = compatibleBrands(bytes);
    if (compatible.some((brand) => AVIF_BRANDS.has(brand))) return "avif";
    if (compatible.some((brand) => HEIC_BRANDS.has(brand))) return "heic";
  }

  // TIFF: "II" 42 or "MM" 42. BigTIFF uses 43 and is detected but unsupported.
  if (
    (bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00) ||
    (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a) ||
    (bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2b && bytes[3] === 0x00) ||
    (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2b)
  ) {
    return "tiff";
  }

  if (startsWithAscii(bytes, "GIF87a") || startsWithAscii(bytes, "GIF89a")) {
    return "gif";
  }

  if (bytes[0] === 0x42 && bytes[1] === 0x4d) return "bmp";

  return "unknown";
}

function compatibleBrands(bytes: Uint8Array): string[] {
  const boxSize =
    (bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3];
  const limit = Math.min(boxSize > 0 ? boxSize : bytes.length, bytes.length);
  const brands: string[] = [];
  for (let offset = 16; offset + 4 <= limit; offset += 4) {
    brands.push(asciiOf(bytes.subarray(offset, offset + 4)));
  }
  return brands;
}

export function describeFormat(format: ImageFormat): FormatDescriptor {
  return FORMAT_DESCRIPTORS[format];
}

export function mimeTypeFor(format: ImageFormat): string {
  return FORMAT_DESCRIPTORS[format].mimeType;
}

export function extensionFor(format: ImageFormat): string {
  return FORMAT_DESCRIPTORS[format].extension;
}
