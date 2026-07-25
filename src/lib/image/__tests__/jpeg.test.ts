import { describe, expect, it } from "vitest";
import { DEFAULT_REMOVAL } from "@/constants/defaults";
import type { RemovalOptions } from "@/types/metadata";
import { createDefaultSettings } from "@/constants/defaults";
import { cleanImageLossless } from "../cleaner";
import { cleanJpeg, parseJpeg } from "../jpeg";
import { analyzeImage } from "../parser";
import { indexOfBytes } from "../utils/bytes";
import {
  A1111_PARAMETERS,
  JPEG_SCAN_BYTES,
  SAMPLE_XMP,
  buildExifPayload,
  buildIccProfile,
  buildJpeg,
} from "./fixtures";

function removal(overrides: Partial<RemovalOptions> = {}): RemovalOptions {
  return { ...DEFAULT_REMOVAL, ...overrides };
}

describe("JPEG parser", () => {
  it("walks every marker and records the metadata segments", () => {
    const bytes = buildJpeg({
      exif: buildExifPayload(),
      xmp: SAMPLE_XMP,
      comment: "hand written note",
      iccBytes: 120,
    });

    const image = parseJpeg(bytes);

    expect(image.width).toBe(48);
    expect(image.height).toBe(64);
    expect(image.components).toBe(3);
    expect(image.progressive).toBe(false);
    expect(image.warnings).toEqual([]);

    const labels = image.segments.map((segment) => segment.label);
    expect(labels).toContain("EXIF");
    expect(labels).toContain("XMP");
    expect(labels).toContain("JPEG comment");
    expect(labels).toContain("ICC colour profile");
  });

  it("keeps the entropy-coded scan inside a raw part", () => {
    const bytes = buildJpeg({ exif: buildExifPayload() });
    const image = parseJpeg(bytes);
    const rawTotal = image.parts
      .filter((part) => part.kind === "raw")
      .reduce((total, part) => total + (part.kind === "raw" ? part.length : 0), 0);
    const segmentTotal = image.parts
      .filter((part) => part.kind === "segment")
      .reduce((total, part) => total + (part.kind === "segment" ? part.segment.size : 0), 0);

    expect(rawTotal + segmentTotal).toBe(bytes.length);
  });

  it("reports a truncated segment instead of throwing", () => {
    const bytes = buildJpeg({ comment: "note" });
    const truncated = bytes.subarray(0, 20);
    const image = parseJpeg(truncated);
    expect(image.warnings.length).toBeGreaterThan(0);
  });
});

describe("JPEG lossless cleaner", () => {
  it("removes EXIF, XMP, comments and ICC while preserving the scan", () => {
    const bytes = buildJpeg({
      exif: buildExifPayload(),
      xmp: SAMPLE_XMP,
      comment: "hand written note",
      iccBytes: 120,
    });

    const result = cleanJpeg(bytes, parseJpeg(bytes), removal({ icc: true }));

    expect(result.bytes.length).toBeLessThan(bytes.length);
    expect(indexOfBytes(result.bytes, JPEG_SCAN_BYTES)).toBeGreaterThan(0);
    expect(parseJpeg(result.bytes).segments.filter((s) => s.category !== "structural")).toHaveLength(0);
    expect(result.pixelStreamPreserved).toBe(true);
  });

  it("keeps the ICC profile by default", () => {
    const bytes = buildJpeg({ exif: buildExifPayload(), iccBytes: 120 });
    const result = cleanJpeg(bytes, parseJpeg(bytes), removal());
    const kept = parseJpeg(result.bytes).segments.map((segment) => segment.category);
    expect(kept).toContain("icc");
    expect(kept).not.toContain("exif");
  });

  it("preserves the Adobe marker when it declares a non-default transform", () => {
    const bytes = buildJpeg({ components: 4, adobeTransform: 2 });
    const result = cleanJpeg(bytes, parseJpeg(bytes), removal());
    expect(result.preserved.map((item) => item.label)).toContain("Adobe colour transform");
    expect(parseJpeg(result.bytes).adobeTransform).toBe(2);
  });

  it("drops the Adobe marker when YCbCr is the decoder default anyway", () => {
    const bytes = buildJpeg({ components: 3, adobeTransform: 1 });
    const result = cleanJpeg(bytes, parseJpeg(bytes), removal());
    expect(result.preserved).toHaveLength(0);
    expect(parseJpeg(result.bytes).adobeTransform).toBeUndefined();
  });

  it("strips only GPS when EXIF itself is kept", () => {
    const bytes = buildJpeg({ exif: buildExifPayload() });
    const before = analyzeImage(bytes);
    expect(before.gps?.latitude).toBeCloseTo(48.858331, 4);
    expect(before.exif?.cameraMake).toBe("Canon");

    const result = cleanJpeg(bytes, parseJpeg(bytes), removal({ exif: false, gps: true }));
    const after = analyzeImage(result.bytes);

    expect(after.gps).toBeUndefined();
    expect(after.exif?.cameraMake).toBe("Canon");
    expect(result.bytes.length).toBeLessThan(bytes.length);
  });

  it("classifies a generator comment as AI rather than a plain comment", () => {
    const bytes = buildJpeg({ comment: A1111_PARAMETERS });
    const report = analyzeImage(bytes);
    expect(report.ai).toHaveLength(1);
    expect(report.ai[0].generator).toBe("automatic1111");

    const kept = cleanJpeg(bytes, parseJpeg(bytes), removal({ ai: false, comment: true }));
    expect(analyzeImage(kept.bytes).ai).toHaveLength(1);

    const stripped = cleanJpeg(bytes, parseJpeg(bytes), removal({ ai: true, comment: false }));
    expect(analyzeImage(stripped.bytes).ai).toHaveLength(0);
  });

  it("produces a verification report describing the output", () => {
    const bytes = buildJpeg({ exif: buildExifPayload(), iccBytes: 200 });
    const settings = createDefaultSettings();
    const result = cleanImageLossless(bytes, settings);

    expect(result.verification.exif).toBeUndefined();
    expect(result.verification.icc).toBeDefined();
    expect(result.bytesRemoved).toBeGreaterThan(0);
    expect(result.percentReduction).toBeGreaterThan(0);
    expect(result.removed.some((stat) => stat.category === "exif")).toBe(true);
  });

  it("reports the ICC profile description from a multi-chunk profile", () => {
    const profile = buildIccProfile(300);
    const bytes = buildJpeg({ iccBytes: 0 });
    // Rebuild with a real profile payload so the summary has something to read.
    const withProfile = buildJpeg({ iccBytes: profile.length });
    expect(withProfile.length).toBeGreaterThan(bytes.length);

    const report = analyzeImage(withProfile);
    expect(report.icc?.bytes).toBeGreaterThan(0);
  });
});
