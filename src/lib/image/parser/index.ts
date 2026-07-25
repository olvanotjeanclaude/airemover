import type { InspectionReport } from "@/types/metadata";
import { CleanError } from "@/types/processing";
import { MAX_FILE_BYTES, MIN_FILE_BYTES } from "@/constants/limits";
import { buildReport } from "../inspector";
import { inspectIsobmff } from "../isobmff";
import { inspectJpeg } from "../jpeg";
import { inspectPng } from "../png";
import { inspectTiff } from "../tiff";
import { detectFormat } from "../utils/format";
import { inspectWebp } from "../webp";
import type { ParsedContainer } from "./types";

export * from "./types";
export {
  detectAiFromSource,
  detectAiMetadata,
  detectProvenanceGenerator,
  containsAiSignature,
  isAiTextKey,
  type AiTextSource,
} from "./ai";

/** Routes to the container parser that matches the file's magic bytes. */
export function parseContainer(bytes: Uint8Array): ParsedContainer {
  const format = detectFormat(bytes);

  switch (format) {
    case "jpeg":
      return inspectJpeg(bytes);
    case "png":
      return inspectPng(bytes);
    case "webp":
      return inspectWebp(bytes);
    case "avif":
    case "heic":
      return inspectIsobmff(bytes, format);
    case "tiff":
      return inspectTiff(bytes);
    case "gif":
    case "bmp":
      throw new CleanError(
        "unsupported-format",
        `${format.toUpperCase()} is not supported. Convert it to PNG or JPEG first.`,
      );
    default:
      throw new CleanError(
        "unsupported-format",
        "This file is not a recognised image container.",
      );
  }
}

/** Validates size limits, then produces the full inspection report. */
export function analyzeImage(bytes: Uint8Array): InspectionReport {
  if (bytes.length === 0) {
    throw new CleanError("empty-file", "The file is empty.");
  }
  if (bytes.length < MIN_FILE_BYTES) {
    throw new CleanError(
      "corrupt-container",
      "The file is too small to contain an image header.",
    );
  }
  if (bytes.length > MAX_FILE_BYTES) {
    throw new CleanError(
      "too-large",
      `The file is larger than the ${Math.round(MAX_FILE_BYTES / (1024 * 1024))} MB limit.`,
    );
  }

  try {
    return buildReport(parseContainer(bytes), bytes.length);
  } catch (error) {
    if (error instanceof CleanError) throw error;
    throw new CleanError(
      "corrupt-container",
      error instanceof Error
        ? `The image structure could not be read: ${error.message}`
        : "The image structure could not be read.",
    );
  }
}
