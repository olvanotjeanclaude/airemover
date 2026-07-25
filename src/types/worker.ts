import type { InspectionReport } from "./metadata";
import type {
  CleanErrorCode,
  ProcessingSettings,
  RemovedCategoryStat,
} from "./processing";
import type { ImageFormat } from "./image";

export interface AnalyzeRequest {
  kind: "analyze";
  jobId: string;
  fileName: string;
  buffer: ArrayBuffer;
}

export interface CleanRequest {
  kind: "clean";
  jobId: string;
  fileName: string;
  buffer: ArrayBuffer;
  settings: ProcessingSettings;
  /**
   * Rebuild mode needs a decoded bitmap. The main thread decodes and transfers
   * it because `createImageBitmap` from a Blob is unavailable in some worker
   * contexts for formats that rely on the platform decoder (HEIC, AVIF).
   */
  bitmap?: ImageBitmap;
}

export type WorkerRequest = AnalyzeRequest | CleanRequest;

export interface AnalyzeSuccess {
  kind: "analyze:done";
  jobId: string;
  report: InspectionReport;
}

export interface CleanSuccess {
  kind: "clean:done";
  jobId: string;
  buffer: ArrayBuffer;
  outputFormat: ImageFormat;
  outputMimeType: string;
  originalSize: number;
  cleanedSize: number;
  bytesRemoved: number;
  percentReduction: number;
  removed: RemovedCategoryStat[];
  remaining: { label: string; bytes: number; reason: string }[];
  pixelStreamPreserved: boolean;
  warnings: string[];
  verification: InspectionReport;
}

export interface WorkerProgress {
  kind: "progress";
  jobId: string;
  /** 0-1 within the current job. */
  value: number;
  stage: string;
}

export interface WorkerFailure {
  kind: "error";
  jobId: string;
  code: CleanErrorCode;
  message: string;
}

export type WorkerResponse =
  | AnalyzeSuccess
  | CleanSuccess
  | WorkerProgress
  | WorkerFailure;
