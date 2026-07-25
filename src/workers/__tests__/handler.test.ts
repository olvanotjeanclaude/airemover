import { describe, expect, it, vi } from "vitest";
import { createDefaultSettings } from "@/constants/defaults";
import type { AnalyzeRequest, CleanRequest } from "@/types/worker";
import { parsePng } from "@/lib/image/png";
import {
  A1111_PARAMETERS,
  buildExifPayload,
  buildJpeg,
  buildPng,
} from "@/lib/image/__tests__/fixtures";
import { handleWorkerRequest } from "../handler";

function toBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer;
}

describe("worker message handler", () => {
  it("answers an analyze request with a report", async () => {
    const request: AnalyzeRequest = {
      kind: "analyze",
      jobId: "job-1",
      fileName: "photo.jpg",
      buffer: toBuffer(buildJpeg({ exif: buildExifPayload(), comment: "note" })),
    };

    const progress = vi.fn();
    const outcome = await handleWorkerRequest(request, progress);

    expect(outcome.response.kind).toBe("analyze:done");
    if (outcome.response.kind !== "analyze:done") return;
    expect(outcome.response.jobId).toBe("job-1");
    expect(outcome.response.report.exif?.cameraMake).toBe("Canon");
    expect(outcome.response.report.gps?.coordinates).toBeDefined();
    expect(progress).toHaveBeenCalled();
    expect(outcome.transfer).toEqual([]);
  });

  it("answers a clean request with transferable output", async () => {
    const original = buildPng({ text: [{ keyword: "parameters", value: A1111_PARAMETERS }] });
    const request: CleanRequest = {
      kind: "clean",
      jobId: "job-2",
      fileName: "render.png",
      buffer: toBuffer(original),
      settings: createDefaultSettings(),
    };

    const outcome = await handleWorkerRequest(request, () => {});

    expect(outcome.response.kind).toBe("clean:done");
    if (outcome.response.kind !== "clean:done") return;

    expect(outcome.transfer).toHaveLength(1);
    expect(outcome.transfer[0]).toBe(outcome.response.buffer);

    const cleaned = new Uint8Array(outcome.response.buffer);
    expect(parsePng(cleaned).chunks.map((chunk) => chunk.type)).toEqual([
      "IHDR",
      "IDAT",
      "IEND",
    ]);
    expect(outcome.response.bytesRemoved).toBeGreaterThan(0);
    expect(outcome.response.pixelStreamPreserved).toBe(true);
    expect(outcome.response.verification.ai).toHaveLength(0);
    expect(outcome.response.removed.some((stat) => stat.category === "ai")).toBe(true);
  });

  it("turns an unsupported container into a coded error, not a throw", async () => {
    const request: AnalyzeRequest = {
      kind: "analyze",
      jobId: "job-3",
      fileName: "notes.txt",
      buffer: toBuffer(new TextEncoder().encode("this is definitely not an image at all")),
    };

    const outcome = await handleWorkerRequest(request, () => {});

    expect(outcome.response.kind).toBe("error");
    if (outcome.response.kind !== "error") return;
    expect(outcome.response.code).toBe("unsupported-format");
    expect(outcome.response.jobId).toBe("job-3");
    expect(outcome.response.message).toMatch(/not a recognised image/i);
  });

  it("reports an empty file with its own code", async () => {
    const request: AnalyzeRequest = {
      kind: "analyze",
      jobId: "job-4",
      fileName: "empty.jpg",
      buffer: new ArrayBuffer(0),
    };

    const outcome = await handleWorkerRequest(request, () => {});
    expect(outcome.response.kind).toBe("error");
    if (outcome.response.kind !== "error") return;
    expect(outcome.response.code).toBe("empty-file");
  });

  it("reports progress in increasing steps", async () => {
    const seen: number[] = [];
    await handleWorkerRequest(
      {
        kind: "clean",
        jobId: "job-5",
        fileName: "photo.jpg",
        buffer: toBuffer(buildJpeg({ exif: buildExifPayload() })),
        settings: createDefaultSettings(),
      },
      (value) => seen.push(value),
    );

    expect(seen.length).toBeGreaterThan(0);
    for (let index = 1; index < seen.length; index += 1) {
      expect(seen[index]).toBeGreaterThanOrEqual(seen[index - 1]);
    }
  });
});
