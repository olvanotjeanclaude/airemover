import type { ImageFormat } from "./image";
import type { InspectionReport, RemovableCategory, RemovalOptions } from "./metadata";

export type ProcessingMode = "lossless" | "rebuild";

export type RebuildFormat = "jpeg" | "png" | "webp" | "original";

export interface RebuildOptions {
  /** Output container. `original` keeps the source format when re-encodable. */
  outputFormat: RebuildFormat;
  /** 1-100, used by JPEG and WebP. */
  jpegQuality: number;
  webpQuality: number;
  /** 0-9, mapped onto the browser's PNG encoder (which is always lossless). */
  pngCompression: number;
  resizeEnabled: boolean;
  /** Longest-edge cap in pixels when `resizeEnabled`. */
  maxDimension: number;
  stripAlpha: boolean;
  /** Colour used where alpha is flattened away. */
  matteColor: string;
}

export interface ProcessingSettings {
  mode: ProcessingMode;
  removal: RemovalOptions;
  rebuild: RebuildOptions;
  /** Appended before the extension, e.g. `photo_clean.jpg`. */
  filenameSuffix: string;
  /** How many files the queue processes at once. */
  concurrency: number;
}

export type FileStatus =
  | "pending"
  | "analyzing"
  | "queued"
  | "processing"
  | "done"
  | "failed"
  | "skipped"
  | "cancelled";

export type CleanErrorCode =
  | "unsupported-format"
  | "corrupt-container"
  | "corrupt-metadata"
  | "empty-file"
  | "too-large"
  | "decode-failed"
  | "encode-failed"
  | "out-of-memory"
  | "worker-crashed"
  | "cancelled"
  | "unknown";

export class CleanError extends Error {
  readonly code: CleanErrorCode;

  constructor(code: CleanErrorCode, message: string) {
    super(message);
    this.name = "CleanError";
    this.code = code;
  }
}

export interface RemovedCategoryStat {
  category: RemovableCategory;
  bytes: number;
  count: number;
}

export interface CleanResult {
  bytes: Uint8Array;
  outputFormat: ImageFormat;
  outputMimeType: string;
  mode: ProcessingMode;
  originalSize: number;
  cleanedSize: number;
  bytesRemoved: number;
  percentReduction: number;
  removed: RemovedCategoryStat[];
  /** Metadata that survived, with the reason it was kept. */
  remaining: { label: string; bytes: number; reason: string }[];
  /** True when the compressed pixel stream is byte-identical to the source. */
  pixelStreamPreserved: boolean;
  warnings: string[];
  /** Report describing the *output* file, used to prove the clean worked. */
  verification: InspectionReport;
}

export interface AnalyzeOutcome {
  report: InspectionReport;
}
