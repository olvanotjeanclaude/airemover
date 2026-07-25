/** Container formats the binary layer can recognise. */
export type ImageFormat =
  | "jpeg"
  | "png"
  | "webp"
  | "avif"
  | "heic"
  | "tiff"
  | "gif"
  | "bmp"
  | "unknown";

/** Formats for which a true byte-level (non re-encoding) cleaner exists. */
export const LOSSLESS_FORMATS = [
  "jpeg",
  "png",
  "webp",
  "avif",
  "heic",
  "tiff",
] as const satisfies readonly ImageFormat[];

export type LosslessFormat = (typeof LOSSLESS_FORMATS)[number];

export interface FormatDescriptor {
  format: ImageFormat;
  /** Canonical extension, without the dot. */
  extension: string;
  mimeType: string;
  label: string;
}

/** Basic geometry and encoding facts read straight from the container headers. */
export interface ImageDimensions {
  width: number;
  height: number;
}

export interface ContainerInfo extends Partial<ImageDimensions> {
  format: ImageFormat;
  /** e.g. "YCbCr", "sRGB", "Grayscale", "CMYK". */
  colorSpace?: string;
  /** Bits per channel where the container states it. */
  bitDepth?: number;
  channels?: number;
  hasAlpha?: boolean;
  isAnimated?: boolean;
  /** JPEG progressive / PNG interlaced. */
  isProgressive?: boolean;
  /** Encoding sub-type, e.g. "Baseline DCT", "VP8L (lossless)". */
  encoding?: string;
}
