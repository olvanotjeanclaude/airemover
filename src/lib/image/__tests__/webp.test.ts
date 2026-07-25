import { describe, expect, it } from "vitest";
import { DEFAULT_REMOVAL } from "@/constants/defaults";
import type { RemovalOptions } from "@/types/metadata";
import { analyzeImage } from "../parser";
import { bytesEqual, indexOfBytes } from "../utils/bytes";
import { VP8X_FLAG, cleanWebpBytes, parseWebp } from "../webp";
import {
  SAMPLE_XMP,
  WEBP_IMAGE_DATA,
  buildExifPayload,
  buildJumbf,
  buildWebp,
} from "./fixtures";

function removal(overrides: Partial<RemovalOptions> = {}): RemovalOptions {
  return { ...DEFAULT_REMOVAL, ...overrides };
}

describe("WebP RIFF parser", () => {
  it("reads the extended header and lists every chunk", () => {
    const bytes = buildWebp({
      exif: buildExifPayload(),
      xmp: SAMPLE_XMP,
      icc: new Uint8Array(64),
    });
    const file = parseWebp(bytes);

    expect(file.extended).toBe(true);
    expect(file.width).toBe(64);
    expect(file.height).toBe(48);
    expect(file.isLossless).toBe(true);
    expect(file.chunks.map((chunk) => chunk.fourCc)).toEqual([
      "VP8X",
      "ICCP",
      "VP8L",
      "EXIF",
      "XMP ",
    ]);
  });

  it("rejects a container that is not WebP", () => {
    const bytes = new Uint8Array(16);
    expect(() => parseWebp(bytes)).toThrow();
  });
});

describe("WebP lossless cleaner", () => {
  it("drops metadata chunks and preserves the image chunk exactly", () => {
    const bytes = buildWebp({
      exif: buildExifPayload(),
      xmp: SAMPLE_XMP,
      c2pa: buildJumbf(),
    });

    const result = cleanWebpBytes(bytes, removal());
    const file = parseWebp(result.bytes);

    expect(file.chunks.map((chunk) => chunk.fourCc)).toEqual(["VP8X", "VP8L"]);
    const image = file.chunks.find((chunk) => chunk.fourCc === "VP8L");
    expect(image).toBeDefined();
    expect(bytesEqual(image!.payload, WEBP_IMAGE_DATA)).toBe(true);
    expect(result.pixelStreamPreserved).toBe(true);
  });

  it("clears the VP8X flags for chunks it removed", () => {
    const bytes = buildWebp({
      exif: buildExifPayload(),
      xmp: SAMPLE_XMP,
      icc: new Uint8Array(64),
    });

    expect(parseWebp(bytes).vp8xFlags & VP8X_FLAG.Exif).toBeTruthy();

    const result = cleanWebpBytes(bytes, removal({ icc: true }));
    const flags = parseWebp(result.bytes).vp8xFlags;

    expect(flags & VP8X_FLAG.Exif).toBe(0);
    expect(flags & VP8X_FLAG.Xmp).toBe(0);
    expect(flags & VP8X_FLAG.Icc).toBe(0);
  });

  it("keeps the ICC flag set when the profile is kept", () => {
    const bytes = buildWebp({ exif: buildExifPayload(), icc: new Uint8Array(64) });
    const result = cleanWebpBytes(bytes, removal());
    const file = parseWebp(result.bytes);

    expect(file.chunks.map((chunk) => chunk.fourCc)).toContain("ICCP");
    expect(file.vp8xFlags & VP8X_FLAG.Icc).toBeTruthy();
  });

  it("writes a RIFF size that matches the rebuilt body", () => {
    const bytes = buildWebp({ exif: buildExifPayload(), xmp: SAMPLE_XMP });
    const result = cleanWebpBytes(bytes, removal());
    const view = new DataView(
      result.bytes.buffer,
      result.bytes.byteOffset,
      result.bytes.byteLength,
    );
    expect(view.getUint32(4, true)).toBe(result.bytes.length - 8);
  });

  it("removes GPS from the EXIF chunk while keeping the rest", () => {
    const bytes = buildWebp({ exif: buildExifPayload() });
    expect(analyzeImage(bytes).gps?.coordinates).toBeDefined();

    const result = cleanWebpBytes(bytes, removal({ exif: false, gps: true }));
    const report = analyzeImage(result.bytes);

    expect(report.gps).toBeUndefined();
    expect(report.exif?.cameraModel).toBe("EOS R5x");
    expect(indexOfBytes(result.bytes, WEBP_IMAGE_DATA)).toBeGreaterThan(0);
  });
});
