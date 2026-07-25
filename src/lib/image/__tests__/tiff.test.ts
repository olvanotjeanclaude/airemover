import { describe, expect, it } from "vitest";
import { DEFAULT_REMOVAL } from "@/constants/defaults";
import type { RemovalOptions } from "@/types/metadata";
import {
  TAG,
  countEntries,
  filterTiffTree,
  findEntry,
  findSubIfd,
  parseTiff,
  readAscii,
  summarizeExif,
  summarizeGps,
  writeTiff,
} from "../exif";
import { cleanTiff, inspectTiff } from "../tiff";
import { bytesEqual } from "../utils/bytes";
import { buildExifPayload, buildTiffImage } from "./fixtures";

function removal(overrides: Partial<RemovalOptions> = {}): RemovalOptions {
  return { ...DEFAULT_REMOVAL, ...overrides };
}

const PIXELS = new Uint8Array([0x10, 0x20, 0x30, 0x40]);

describe("TIFF directory reader", () => {
  it("resolves nested EXIF and GPS directories", () => {
    const tree = parseTiff(buildExifPayload());

    expect(tree.littleEndian).toBe(false);
    expect(tree.ifds).toHaveLength(1);
    expect(findSubIfd(tree, "exif")).toBeDefined();
    expect(findSubIfd(tree, "gps")).toBeDefined();
    expect(countEntries(tree)).toBeGreaterThan(5);

    const summary = summarizeExif(tree);
    expect(summary.cameraMake).toBe("Canon");
    expect(summary.cameraModel).toBe("EOS R5x");
    expect(summary.userComment).toBe("Hello from the camera");

    const gps = summarizeGps(tree);
    expect(gps?.latitude).toBeCloseTo(48.858331, 4);
    expect(gps?.longitude).toBeCloseTo(2.291117, 4);
  });

  it("survives a directory offset that points past the payload", () => {
    const payload = buildExifPayload();
    const damaged = payload.slice();
    // Point IFD0 at an offset well beyond the end of the buffer.
    new DataView(damaged.buffer).setUint32(4, 0xfffff0);
    expect(() => parseTiff(damaged)).toThrow(/no readable directory/);
  });
});

describe("TIFF writer", () => {
  it("round-trips a directory tree without losing values", () => {
    const original = parseTiff(buildExifPayload());
    const rebuilt = parseTiff(writeTiff(original));

    expect(countEntries(rebuilt)).toBe(countEntries(original));
    expect(summarizeExif(rebuilt).cameraMake).toBe("Canon");
    expect(summarizeGps(rebuilt)?.latitude).toBeCloseTo(48.858331, 4);
  });

  it("relocates strip data and repairs the offsets", () => {
    const file = buildTiffImage(PIXELS);
    const tree = parseTiff(file);
    const stripEntry = findEntry(tree.ifds[0], TAG.StripOffsets);

    expect(stripEntry?.dataBlocks).toHaveLength(1);
    expect(bytesEqual(stripEntry!.dataBlocks![0], PIXELS)).toBe(true);

    const rebuilt = writeTiff(tree);
    const reparsed = parseTiff(rebuilt);
    const reparsedStrip = findEntry(reparsed.ifds[0], TAG.StripOffsets);

    expect(reparsedStrip?.dataBlocks).toHaveLength(1);
    expect(bytesEqual(reparsedStrip!.dataBlocks![0], PIXELS)).toBe(true);
  });
});

describe("TIFF cleaner", () => {
  it("keeps pixel data and structural tags, drops identity tags", () => {
    const file = buildTiffImage(PIXELS);
    const before = inspectTiff(file);
    expect(before.container.width).toBe(2);
    expect(before.container.height).toBe(2);

    const result = cleanTiff(file, removal());
    const tree = parseTiff(result.bytes);
    const ifd0 = tree.ifds[0];

    expect(findEntry(ifd0, TAG.Make)).toBeUndefined();
    expect(findEntry(ifd0, TAG.Artist)).toBeUndefined();
    expect(findEntry(ifd0, TAG.GPSIFDPointer)).toBeUndefined();
    expect(findEntry(ifd0, TAG.ImageWidth)).toBeDefined();
    expect(findEntry(ifd0, TAG.Compression)).toBeDefined();

    const strip = findEntry(ifd0, TAG.StripOffsets);
    expect(bytesEqual(strip!.dataBlocks![0], PIXELS)).toBe(true);
    expect(result.bytes.length).toBeLessThan(file.length);
    expect(result.pixelStreamPreserved).toBe(true);
  });

  it("removes only GPS when the EXIF switch is off", () => {
    const file = buildTiffImage(PIXELS);
    const result = cleanTiff(file, removal({ exif: false, gps: true }));
    const tree = parseTiff(result.bytes);

    expect(findEntry(tree.ifds[0], TAG.GPSIFDPointer)).toBeUndefined();
    expect(readAscii(findEntry(tree.ifds[0], TAG.Make)!)).toBe("Canon");
  });

  it("returns the input untouched when nothing matches", () => {
    const file = buildTiffImage(PIXELS);
    const nothing: RemovalOptions = {
      exif: false,
      gps: false,
      xmp: false,
      iptc: false,
      icc: false,
      c2pa: false,
      ai: false,
      comment: false,
      other: false,
    };
    const result = cleanTiff(file, nothing);
    expect(bytesEqual(result.bytes, file)).toBe(true);
  });
});

describe("EXIF tree filtering", () => {
  it("reports the categories it removed", () => {
    const tree = parseTiff(buildExifPayload());
    const outcome = filterTiffTree(tree, removal(), "embedded");

    expect(outcome.changed).toBe(true);
    expect(outcome.removed.get("exif")).toBeDefined();
    expect(outcome.tree).toBeNull();
  });

  it("keeps a usable tree when only GPS goes", () => {
    const tree = parseTiff(buildExifPayload());
    const outcome = filterTiffTree(tree, removal({ exif: false, gps: true, comment: false }), "embedded");

    expect(outcome.tree).not.toBeNull();
    const rebuilt = parseTiff(writeTiff(outcome.tree!));
    expect(findSubIfd(rebuilt, "gps")).toBeUndefined();
    expect(findSubIfd(rebuilt, "exif")).toBeDefined();
  });
});
