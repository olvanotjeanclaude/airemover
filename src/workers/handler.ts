import { CleanError, type CleanErrorCode } from "@/types/processing";
import type { WorkerRequest, WorkerResponse } from "@/types/worker";
import { cleanImageLossless, cleanImageRebuild } from "@/lib/image/cleaner";
import { analyzeImage } from "@/lib/image/parser";

export interface HandlerOutcome {
  response: WorkerResponse;
  transfer: Transferable[];
}

/**
 * The worker's entire behaviour, expressed without touching `self`. Keeping it
 * pure means the message contract is unit-testable without spinning up a real
 * Worker, and the worker entry point stays a five-line adapter.
 */
export async function handleWorkerRequest(
  request: WorkerRequest,
  reportProgress: (value: number, stage: string) => void,
): Promise<HandlerOutcome> {
  try {
    if (request.kind === "analyze") {
      reportProgress(0.1, "Reading container");
      const bytes = new Uint8Array(request.buffer);
      const report = analyzeImage(bytes);
      reportProgress(1, "Analysed");
      return {
        response: { kind: "analyze:done", jobId: request.jobId, report },
        transfer: [],
      };
    }

    reportProgress(0.1, "Parsing");
    const bytes = new Uint8Array(request.buffer);

    const result =
      request.settings.mode === "rebuild" && request.bitmap
        ? await cleanImageRebuild(bytes, request.bitmap, request.settings)
        : cleanImageLossless(bytes, request.settings);

    if (request.settings.mode === "rebuild" && !request.bitmap) {
      throw new CleanError(
        "decode-failed",
        "Rebuild mode needs a decoded image, and this file could not be decoded by the browser.",
      );
    }

    reportProgress(0.9, "Writing output");
    const buffer = toTransferableBuffer(result.bytes);

    return {
      response: {
        kind: "clean:done",
        jobId: request.jobId,
        buffer,
        outputFormat: result.outputFormat,
        outputMimeType: result.outputMimeType,
        originalSize: result.originalSize,
        cleanedSize: result.cleanedSize,
        bytesRemoved: result.bytesRemoved,
        percentReduction: result.percentReduction,
        removed: result.removed,
        remaining: result.remaining,
        pixelStreamPreserved: result.pixelStreamPreserved,
        warnings: result.warnings,
        verification: result.verification,
      },
      transfer: [buffer],
    };
  } catch (error) {
    return {
      response: {
        kind: "error",
        jobId: request.jobId,
        code: errorCode(error),
        message: errorMessage(error),
      },
      transfer: [],
    };
  } finally {
    if (request.kind === "clean" && request.bitmap) {
      request.bitmap.close();
    }
  }
}

/** Only hand over a buffer we own outright, otherwise copy first. */
function toTransferableBuffer(bytes: Uint8Array): ArrayBuffer {
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) {
    return bytes.buffer as ArrayBuffer;
  }
  return bytes.slice().buffer as ArrayBuffer;
}

function errorCode(error: unknown): CleanErrorCode {
  if (error instanceof CleanError) return error.code;
  if (error instanceof RangeError) return "out-of-memory";
  return "unknown";
}

function errorMessage(error: unknown): string {
  if (error instanceof CleanError) return error.message;
  if (error instanceof RangeError) {
    return "The browser ran out of memory while processing this image.";
  }
  if (error instanceof Error) return error.message;
  return "An unexpected error occurred while processing this image.";
}
