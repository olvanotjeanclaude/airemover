import { describe, expect, it } from "vitest";
import { DEFAULT_REMOVAL } from "@/constants/defaults";
import type { RemovalOptions } from "@/types/metadata";
import { categorizeChunk, cleanPngBytes, parsePng } from "../png";
import { analyzeImage } from "../parser";
import { crc32 } from "../utils/crc32";
import { asciiOf } from "../utils/bytes";
import {
  A1111_PARAMETERS,
  COMFY_PROMPT,
  NOVELAI_COMMENT,
  SAMPLE_XMP,
  buildExifPayload,
  buildJumbf,
  buildPng,
} from "./fixtures";

function removal(overrides: Partial<RemovalOptions> = {}): RemovalOptions {
  return { ...DEFAULT_REMOVAL, ...overrides };
}

function chunkTypes(bytes: Uint8Array): string[] {
  return parsePng(bytes).chunks.map((chunk) => chunk.type);
}

describe("PNG chunk parser", () => {
  it("reads the header and validates every CRC", () => {
    const bytes = buildPng({ text: [{ keyword: "Software", value: "Adobe Photoshop" }] });
    const file = parsePng(bytes);

    expect(file.width).toBe(4);
    expect(file.height).toBe(4);
    expect(file.bitDepth).toBe(8);
    expect(file.colorType).toBe(6);
    expect(file.chunks.every((chunk) => chunk.crcValid)).toBe(true);
    expect(file.warnings).toEqual([]);
  });

  it("flags a corrupted chunk rather than throwing", () => {
    const bytes = buildPng({ text: [{ keyword: "Comment", value: "hello" }] });
    // Corrupt one byte of the tEXt payload so its stored CRC no longer matches.
    const textStart = bytes.indexOf(0x43); // 'C' of "Comment"
    const damaged = bytes.slice();
    damaged[textStart + 1] = 0x5a;

    const file = parsePng(damaged);
    expect(file.warnings.some((warning) => warning.includes("bad CRC"))).toBe(true);
  });

  it("categorises text chunks by their content, not just their type", () => {
    const bytes = buildPng({
      text: [
        { keyword: "parameters", value: A1111_PARAMETERS },
        { keyword: "Copyright", value: "(c) Jess" },
      ],
      internationalText: [{ keyword: "XML:com.adobe.xmp", value: SAMPLE_XMP }],
    });

    const file = parsePng(bytes);
    const byType = new Map(file.chunks.map((chunk) => [chunk.type + chunk.offset, chunk]));
    const categories = [...byType.values()]
      .filter((chunk) => chunk.type === "tEXt" || chunk.type === "iTXt")
      .map(categorizeChunk);

    expect(categories).toContain("ai");
    expect(categories).toContain("comment");
    expect(categories).toContain("xmp");
  });
});

describe("PNG lossless cleaner", () => {
  it("keeps critical chunks and drops metadata ones", () => {
    const bytes = buildPng({
      text: [{ keyword: "parameters", value: A1111_PARAMETERS }],
      compressedText: [{ keyword: "Description", value: "a compressed caption" }],
      exif: buildExifPayload(),
      c2pa: buildJumbf(),
    });

    const result = cleanPngBytes(bytes, removal());
    const types = chunkTypes(result.bytes);

    expect(types).toEqual(["IHDR", "IDAT", "IEND"]);
    expect(result.pixelStreamPreserved).toBe(true);
    expect(result.removed.get("ai")?.count).toBe(1);
    expect(result.removed.get("exif")?.count).toBe(1);
    expect(result.removed.get("c2pa")?.count).toBe(1);
  });

  it("recomputes a valid CRC for every chunk it writes", () => {
    const bytes = buildPng({ text: [{ keyword: "Comment", value: "x" }] });
    const result = cleanPngBytes(bytes, removal());
    const file = parsePng(result.bytes);

    expect(file.chunks.every((chunk) => chunk.crcValid)).toBe(true);
    for (const chunk of file.chunks) {
      const computed = crc32(
        new TextEncoder().encode(chunk.type),
        chunk.data,
      );
      expect(computed).toBe(chunk.declaredCrc);
    }
  });

  it("copies the IDAT payload byte for byte", () => {
    const bytes = buildPng({ text: [{ keyword: "Comment", value: "remove me" }] });
    const before = parsePng(bytes).chunks.find((chunk) => chunk.type === "IDAT");
    const after = parsePng(cleanPngBytes(bytes, removal()).bytes).chunks.find(
      (chunk) => chunk.type === "IDAT",
    );

    expect(before).toBeDefined();
    expect(after).toBeDefined();
    expect(asciiOf(after!.data)).toBe(asciiOf(before!.data));
  });

  it("keeps a plain comment when only AI removal is on", () => {
    const bytes = buildPng({
      text: [
        { keyword: "parameters", value: A1111_PARAMETERS },
        { keyword: "Copyright", value: "(c) Jess" },
      ],
    });

    const result = cleanPngBytes(bytes, removal({ ai: true, comment: false }));
    const report = analyzeImage(result.bytes);

    expect(report.ai).toHaveLength(0);
    expect(chunkTypes(result.bytes).filter((type) => type === "tEXt")).toHaveLength(1);
  });

  it("keeps the ICC profile chunk by default", () => {
    const bytes = buildPng({
      icc: new Uint8Array(200),
      text: [{ keyword: "Comment", value: "hi" }],
    });
    const result = cleanPngBytes(bytes, removal());
    expect(chunkTypes(result.bytes)).toContain("iCCP");
  });

  it("detects ComfyUI and NovelAI payloads", () => {
    const comfy = analyzeImage(buildPng({ text: [{ keyword: "prompt", value: COMFY_PROMPT }] }));
    expect(comfy.ai[0].generator).toBe("comfyui");
    expect(comfy.ai[0].prompt).toBe("a red fox in the snow");
    expect(comfy.ai[0].negativePrompt).toBe("text, watermark");
    expect(comfy.ai[0].seed).toBe("918273645");
    expect(comfy.ai[0].model).toBe("sd_xl_base_1.0.safetensors");
    expect(comfy.ai[0].loras).toEqual(["add_detail.safetensors"]);

    const novelai = analyzeImage(
      buildPng({
        text: [
          { keyword: "Software", value: "NovelAI" },
          { keyword: "Comment", value: NOVELAI_COMMENT },
        ],
      }),
    );
    expect(novelai.ai[0].generator).toBe("novelai");
    expect(novelai.ai[0].negativePrompt).toBe("lowres, bad anatomy");
    expect(novelai.ai[0].seed).toBe("3141592653");
  });

  it("reads a zlib-compressed zTXt payload", () => {
    const report = analyzeImage(
      buildPng({ compressedText: [{ keyword: "parameters", value: A1111_PARAMETERS }] }),
    );
    expect(report.ai[0].generator).toBe("automatic1111");
    expect(report.ai[0].steps).toBe("32");
  });
});
