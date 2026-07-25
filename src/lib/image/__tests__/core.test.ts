import { describe, expect, it } from "vitest";
import { CleanError } from "@/types/processing";
import { analyzeImage } from "../parser";
import { encodePng } from "../cleaner/png-encode";
import { parsePng } from "../png";
import { ByteReader, ByteWriter, bytesEqual, indexOfAscii } from "../utils/bytes";
import { crc32, crc32Update } from "../utils/crc32";
import { detectFormat } from "../utils/format";
import { cleanedFileName, formatBytes } from "../utils/size";
import { decodeUserComment, sanitizeForDisplay } from "../utils/text";
import { buildAvif } from "./avif-fixture";
import {
  ascii,
  buildExifPayload,
  buildJpeg,
  buildPng,
  buildWebp,
  buildTiffImage,
  concat,
} from "./fixtures";

describe("CRC-32", () => {
  it("matches the published check value", () => {
    // The IEEE check value for "123456789" is 0xCBF43926.
    expect(crc32(ascii("123456789"))).toBe(0xcbf43926);
  });

  it("is identical whether fed in one part or several", () => {
    const whole = ascii("The quick brown fox jumps over the lazy dog");
    const first = whole.subarray(0, 10);
    const rest = whole.subarray(10);
    expect(crc32(first, rest)).toBe(crc32(whole));
  });

  it("supports incremental accumulation", () => {
    const data = ascii("IHDRpayload");
    let running = 0xffffffff;
    running = crc32Update(running, data.subarray(0, 4));
    running = crc32Update(running, data.subarray(4));
    expect((running ^ 0xffffffff) >>> 0).toBe(crc32(data));
  });

  it("produces PNG chunk CRCs the parser accepts", () => {
    const bytes = buildPng({ text: [{ keyword: "Comment", value: "check" }] });
    expect(parsePng(bytes).chunks.every((chunk) => chunk.crcValid)).toBe(true);
  });
});

describe("format detection", () => {
  it("identifies every supported container from its magic bytes", () => {
    expect(detectFormat(buildJpeg())).toBe("jpeg");
    expect(detectFormat(buildPng())).toBe("png");
    expect(detectFormat(buildWebp())).toBe("webp");
    expect(detectFormat(buildTiffImage(new Uint8Array([1, 2, 3, 4])))).toBe("tiff");
    expect(detectFormat(buildAvif({ exifPayload: buildExifPayload() }).bytes)).toBe("avif");
  });

  it("ignores the file extension and trusts the bytes", () => {
    const jpegBytes = buildJpeg();
    expect(detectFormat(jpegBytes)).toBe("jpeg");
    expect(detectFormat(new Uint8Array(32))).toBe("unknown");
  });

  it("rejects unsupported containers with a friendly error", () => {
    const gif = concat([ascii("GIF89a"), new Uint8Array(32)]);
    expect(() => analyzeImage(gif)).toThrow(CleanError);
    try {
      analyzeImage(gif);
    } catch (error) {
      expect((error as CleanError).code).toBe("unsupported-format");
    }
  });

  it("reports an empty file distinctly from a corrupt one", () => {
    try {
      analyzeImage(new Uint8Array(0));
    } catch (error) {
      expect((error as CleanError).code).toBe("empty-file");
    }
    try {
      analyzeImage(new Uint8Array(4));
    } catch (error) {
      expect((error as CleanError).code).toBe("corrupt-container");
    }
  });
});

describe("byte primitives", () => {
  it("reads big and little endian consistently", () => {
    const writer = new ByteWriter();
    writer.u16(0x1234).u32(0xdeadbeef).u24(0x010203, true).u64(0x1_0000_0002);
    const bytes = writer.finish();
    const reader = new ByteReader(bytes);

    expect(reader.u16()).toBe(0x1234);
    expect(reader.u32()).toBe(0xdeadbeef);
    expect(reader.u24(true)).toBe(0x010203);
    expect(reader.u64()).toBe(0x1_0000_0002);
  });

  it("throws a bounded error instead of a RangeError", () => {
    const reader = new ByteReader(new Uint8Array(2));
    expect(() => reader.u32()).toThrow(/Truncated/);
  });

  it("back-patches previously written values", () => {
    const writer = new ByteWriter();
    writer.u32(0);
    writer.ascii("mdat");
    writer.patchU32(0, writer.length);
    const bytes = writer.finish();
    expect(new DataView(bytes.buffer).getUint32(0)).toBe(8);
  });

  it("finds byte sequences", () => {
    const haystack = ascii("hello world");
    expect(indexOfAscii(haystack, "world")).toBe(6);
    expect(indexOfAscii(haystack, "absent")).toBe(-1);
  });
});

describe("text decoding", () => {
  it("honours the UserComment character-code prefix", () => {
    const asciiComment = concat([ascii("ASCII\0\0\0"), ascii("plain text")]);
    expect(decodeUserComment(asciiComment)).toBe("plain text");

    const unicodeBody = new Uint8Array([0, 0x68, 0, 0x69]);
    const unicodeComment = concat([ascii("UNICODE\0"), unicodeBody]);
    expect(decodeUserComment(unicodeComment)).toBe("hi");
  });

  it("strips control characters but keeps newlines", () => {
    const noisy = `line one\nline two${String.fromCharCode(7)}${String.fromCharCode(0)}`;
    expect(sanitizeForDisplay(noisy)).toBe("line one\nline two");
  });
});

describe("formatting helpers", () => {
  it("renders byte counts at a readable scale", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(999)).toBe("999 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });

  it("builds a safe cleaned filename", () => {
    expect(cleanedFileName("holiday.JPG", "jpg", "_clean")).toBe("holiday_clean.jpg");
    expect(cleanedFileName("a/b:c.png", "png", "_clean")).toBe("a_b_c_clean.png");
    expect(cleanedFileName("noext", "webp", "-safe")).toBe("noext-safe.webp");
  });
});

describe("PNG encoder", () => {
  it("produces a file the parser reads back with the same geometry", () => {
    const width = 8;
    const height = 6;
    const pixels = new Uint8ClampedArray(width * height * 4);
    for (let index = 0; index < pixels.length; index += 4) {
      pixels[index] = index % 255;
      pixels[index + 1] = 128;
      pixels[index + 2] = 255 - (index % 255);
      pixels[index + 3] = 255;
    }

    const encoded = encodePng(pixels, width, height, { level: 6, stripAlpha: false });
    const parsed = parsePng(encoded);

    expect(parsed.width).toBe(width);
    expect(parsed.height).toBe(height);
    expect(parsed.colorType).toBe(6);
    expect(parsed.chunks.every((chunk) => chunk.crcValid)).toBe(true);
    expect(analyzeImage(encoded).metadataBytes).toBe(0);
  });

  it("drops the alpha channel when asked", () => {
    const pixels = new Uint8ClampedArray(4 * 4 * 4).fill(200);
    const encoded = encodePng(pixels, 4, 4, { level: 9, stripAlpha: true });
    expect(parsePng(encoded).colorType).toBe(2);
  });

  it("compresses harder at a higher level", () => {
    const width = 64;
    const height = 64;
    const pixels = new Uint8ClampedArray(width * height * 4);
    for (let index = 0; index < pixels.length; index += 4) {
      const value = Math.floor(index / 4) % 200;
      pixels[index] = value;
      pixels[index + 1] = value;
      pixels[index + 2] = value;
      pixels[index + 3] = 255;
    }

    const stored = encodePng(pixels, width, height, { level: 0, stripAlpha: false });
    const packed = encodePng(pixels, width, height, { level: 9, stripAlpha: false });

    expect(packed.length).toBeLessThan(stored.length);
    expect(bytesEqual(stored, packed)).toBe(false);
  });
});
