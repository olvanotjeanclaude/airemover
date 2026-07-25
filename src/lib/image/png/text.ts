import { unzlibSync } from "fflate";
import { decodeLatin1, decodeUtf8, trimNulls } from "../utils/text";
import type { PngChunk } from "./chunks";

/** The keyword Adobe uses to store an XMP packet inside an iTXt chunk. */
export const XMP_KEYWORD = "XML:com.adobe.xmp";

export interface PngText {
  keyword: string;
  text: string;
  /** True when the payload was zlib-compressed in the file. */
  compressed: boolean;
  languageTag?: string;
  translatedKeyword?: string;
  /** Set when the payload could not be inflated. */
  error?: string;
}

function indexOfNul(bytes: Uint8Array, from: number, limit: number): number {
  for (let index = from; index < limit; index += 1) {
    if (bytes[index] === 0) return index;
  }
  return -1;
}

function inflate(bytes: Uint8Array): { text: string; error?: string } {
  if (bytes.length === 0) return { text: "" };
  try {
    return { text: decodeUtf8(unzlibSync(bytes)) };
  } catch (error) {
    return {
      text: "",
      error: error instanceof Error ? error.message : "decompression failed",
    };
  }
}

/**
 * Decodes tEXt, zTXt and iTXt. A malformed chunk yields an entry with an
 * `error` rather than throwing, so one bad text block never stops an
 * inspection: the chunk is still removable, which is all the cleaner needs.
 */
export function decodePngText(chunk: PngChunk): PngText | null {
  const data = chunk.data;
  const separator = indexOfNul(data, 0, Math.min(data.length, 80));
  if (separator < 0) return null;
  const keyword = trimNulls(decodeLatin1(data.subarray(0, separator)));

  if (chunk.type === "tEXt") {
    return {
      keyword,
      text: decodeLatin1(data.subarray(separator + 1)),
      compressed: false,
    };
  }

  if (chunk.type === "zTXt") {
    const method = data[separator + 1];
    if (method !== 0) {
      return { keyword, text: "", compressed: true, error: `unknown compression method ${method}` };
    }
    const result = inflate(data.subarray(separator + 2));
    return { keyword, text: result.text, compressed: true, error: result.error };
  }

  if (chunk.type === "iTXt") {
    const compressionFlag = data[separator + 1];
    const languageStart = separator + 3;
    const languageEnd = indexOfNul(data, languageStart, data.length);
    if (languageEnd < 0) return { keyword, text: "", compressed: false, error: "missing language tag" };
    const translatedEnd = indexOfNul(data, languageEnd + 1, data.length);
    if (translatedEnd < 0) {
      return { keyword, text: "", compressed: false, error: "missing translated keyword" };
    }
    const body = data.subarray(translatedEnd + 1);
    const languageTag = decodeLatin1(data.subarray(languageStart, languageEnd)) || undefined;
    const translatedKeyword =
      decodeUtf8(data.subarray(languageEnd + 1, translatedEnd)) || undefined;

    if (compressionFlag === 1) {
      const result = inflate(body);
      return {
        keyword,
        text: result.text,
        compressed: true,
        languageTag,
        translatedKeyword,
        error: result.error,
      };
    }
    return {
      keyword,
      text: decodeUtf8(body),
      compressed: false,
      languageTag,
      translatedKeyword,
    };
  }

  return null;
}

export interface IccpChunk {
  name: string;
  profile: Uint8Array;
  error?: string;
}

/** iCCP holds a zlib-compressed ICC profile behind a NUL-terminated name. */
export function decodeIccp(chunk: PngChunk): IccpChunk | null {
  const data = chunk.data;
  const separator = indexOfNul(data, 0, Math.min(data.length, 80));
  if (separator < 0) return null;
  const name = trimNulls(decodeLatin1(data.subarray(0, separator)));
  const method = data[separator + 1];
  if (method !== 0) {
    return { name, profile: new Uint8Array(0), error: `unknown compression method ${method}` };
  }
  try {
    return { name, profile: unzlibSync(data.subarray(separator + 2)) };
  } catch (error) {
    return {
      name,
      profile: new Uint8Array(0),
      error: error instanceof Error ? error.message : "decompression failed",
    };
  }
}
