import { describe, expect, it } from "vitest";
import { DEFAULT_REMOVAL } from "@/constants/defaults";
import type { RemovalOptions } from "@/types/metadata";
import { checkLosslessSupport, cleanIsobmff, findBox, parseBoxes } from "../isobmff";
import { normalizeItemLocations, parseItemInfo, parseItemLocation } from "../isobmff/meta";
import { readItemData } from "../isobmff/items";
import { analyzeImage } from "../parser";
import { bytesEqual, indexOfBytes } from "../utils/bytes";
import { buildAvif } from "./avif-fixture";
import { SAMPLE_XMP, buildExifPayload, buildJumbf } from "./fixtures";

function removal(overrides: Partial<RemovalOptions> = {}): RemovalOptions {
  return { ...DEFAULT_REMOVAL, ...overrides };
}

function itemDataFor(bytes: Uint8Array, itemId: number): Uint8Array | null {
  const meta = findBox(parseBoxes(bytes), "meta");
  if (!meta) return null;
  const ilocBox = findBox(meta.children ?? [], "iloc");
  if (!ilocBox) return null;
  const locations = normalizeItemLocations(parseItemLocation(bytes, ilocBox).items);
  const location = locations.find((item) => item.itemId === itemId);
  const idat = (meta.children ?? []).find((box) => box.type === "idat");
  return readItemData(bytes, location, idat);
}

describe("ISOBMFF parser", () => {
  it("reads the item info and item location tables", () => {
    const fixture = buildAvif({ exifPayload: buildExifPayload(), xmp: SAMPLE_XMP });
    const meta = findBox(parseBoxes(fixture.bytes), "meta");
    expect(meta).toBeDefined();

    const iinf = parseItemInfo(fixture.bytes, findBox(meta!.children ?? [], "iinf")!);
    expect(iinf.entries.map((entry) => entry.itemType)).toEqual(["av01", "Exif", "mime"]);
    expect(iinf.entries[2].contentType).toBe("application/rdf+xml");

    const iloc = parseItemLocation(fixture.bytes, findBox(meta!.children ?? [], "iloc")!);
    expect(iloc.version).toBe(1);
    expect(iloc.items).toHaveLength(3);
  });

  it("resolves an item's bytes through its extents", () => {
    const fixture = buildAvif({ exifPayload: buildExifPayload() });
    const image = itemDataFor(fixture.bytes, 1);
    expect(image).not.toBeNull();
    expect(bytesEqual(image!, fixture.imageData)).toBe(true);
  });

  it("accepts the fixture for byte-level cleaning", () => {
    const fixture = buildAvif({ exifPayload: buildExifPayload() });
    expect(checkLosslessSupport(fixture.bytes)).toBeUndefined();
  });
});

describe("AVIF inspection", () => {
  it("surfaces geometry, EXIF, GPS and C2PA", () => {
    const fixture = buildAvif({
      exifPayload: buildExifPayload(),
      xmp: SAMPLE_XMP,
      c2pa: buildJumbf(),
      width: 1200,
      height: 800,
    });

    const report = analyzeImage(fixture.bytes);

    expect(report.format).toBe("avif");
    expect(report.container.width).toBe(1200);
    expect(report.container.height).toBe(800);
    expect(report.exif?.cameraMake).toBe("Canon");
    expect(report.gps?.latitude).toBeCloseTo(48.858331, 4);
    expect(report.c2pa?.assertions).toContain("c2pa");
    expect(report.xmp?.creator).toBe("Jess");
    expect(report.losslessSupported).toBe(true);
  });
});

describe("AVIF lossless cleaner", () => {
  it("removes metadata items and keeps the coded image byte-identical", () => {
    const fixture = buildAvif({
      exifPayload: buildExifPayload(),
      xmp: SAMPLE_XMP,
      c2pa: buildJumbf(),
    });

    const result = cleanIsobmff(fixture.bytes, removal());

    expect(result.bytes.length).toBeLessThan(fixture.bytes.length);
    expect(result.pixelStreamPreserved).toBe(true);

    const image = itemDataFor(result.bytes, 1);
    expect(image).not.toBeNull();
    expect(bytesEqual(image!, fixture.imageData)).toBe(true);

    const meta = findBox(parseBoxes(result.bytes), "meta")!;
    const iinf = parseItemInfo(result.bytes, findBox(meta.children ?? [], "iinf")!);
    expect(iinf.entries.map((entry) => entry.itemId)).toEqual([1]);

    const report = analyzeImage(result.bytes);
    expect(report.exif).toBeUndefined();
    expect(report.xmp).toBeUndefined();
    expect(report.c2pa).toBeUndefined();
  });

  it("drops the top-level C2PA uuid box", () => {
    const manifest = buildJumbf("c2pa.assertions");
    const fixture = buildAvif({ exifPayload: buildExifPayload(), c2pa: manifest });

    expect(indexOfBytes(fixture.bytes, manifest)).toBeGreaterThan(0);
    const result = cleanIsobmff(fixture.bytes, removal());
    expect(indexOfBytes(result.bytes, manifest)).toBe(-1);
    expect(parseBoxes(result.bytes).some((box) => box.type === "uuid")).toBe(false);
  });

  it("keeps EXIF when its switch is off", () => {
    const fixture = buildAvif({ exifPayload: buildExifPayload(), xmp: SAMPLE_XMP });
    const result = cleanIsobmff(fixture.bytes, removal({ exif: false, gps: false }));

    const report = analyzeImage(result.bytes);
    expect(report.exif?.cameraMake).toBe("Canon");
    expect(report.xmp).toBeUndefined();
  });

  it("returns the original bytes when nothing is selected", () => {
    const fixture = buildAvif({ exifPayload: buildExifPayload() });
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
    const result = cleanIsobmff(fixture.bytes, nothing);
    expect(bytesEqual(result.bytes, fixture.bytes)).toBe(true);
  });

  it("refuses files that carry a movie box", () => {
    const fixture = buildAvif({ exifPayload: buildExifPayload() });
    const moov = new Uint8Array([0, 0, 0, 8, 0x6d, 0x6f, 0x6f, 0x76]);
    const withMoov = new Uint8Array(fixture.bytes.length + moov.length);
    withMoov.set(fixture.bytes, 0);
    withMoov.set(moov, fixture.bytes.length);

    expect(checkLosslessSupport(withMoov)).toContain("movie box");
    expect(() => cleanIsobmff(withMoov, removal())).toThrow();
  });
});
