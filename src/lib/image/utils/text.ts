const decoders = new Map<string, TextDecoder>();

function decoderFor(encoding: string): TextDecoder | null {
  const cached = decoders.get(encoding);
  if (cached) return cached;
  try {
    const decoder = new TextDecoder(encoding, { fatal: false });
    decoders.set(encoding, decoder);
    return decoder;
  } catch {
    return null;
  }
}

export function decodeUtf8(bytes: Uint8Array): string {
  return decoderFor("utf-8")?.decode(bytes) ?? "";
}

/** Latin-1 is the declared encoding of PNG `tEXt` and JPEG `COM`. */
export function decodeLatin1(bytes: Uint8Array): string {
  const decoder = decoderFor("iso-8859-1");
  if (decoder) return decoder.decode(bytes);
  let out = "";
  for (let index = 0; index < bytes.length; index += 1) {
    out += String.fromCharCode(bytes[index]);
  }
  return out;
}

export function decodeUtf16(bytes: Uint8Array, littleEndian: boolean): string {
  const decoder = decoderFor(littleEndian ? "utf-16le" : "utf-16be");
  if (decoder) return decoder.decode(bytes);
  let out = "";
  for (let index = 0; index + 1 < bytes.length; index += 2) {
    const code = littleEndian
      ? bytes[index] | (bytes[index + 1] << 8)
      : (bytes[index] << 8) | bytes[index + 1];
    out += String.fromCharCode(code);
  }
  return out;
}

/** Strips leading and trailing NUL padding, then surrounding whitespace. */
export function trimNulls(text: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && text.charCodeAt(start) === 0) start += 1;
  while (end > start && text.charCodeAt(end - 1) === 0) end -= 1;
  return text.slice(start, end).trim();
}

/**
 * EXIF `UserComment` starts with an 8-byte character-code marker that says how
 * the rest is encoded. Undefined markers fall back to Latin-1, which is what
 * the cameras that get it wrong actually write.
 */
export function decodeUserComment(bytes: Uint8Array): string {
  if (bytes.length <= 8) return "";
  const body = bytes.subarray(8);
  const tag = trimNulls(decodeLatin1(bytes.subarray(0, 5)));
  if (tag === "ASCII") return trimNulls(decodeLatin1(body));
  if (tag === "UNICO") {
    // UCS-2. Endianness follows the TIFF header, but a BOM wins when present.
    if (body[0] === 0xff && body[1] === 0xfe) {
      return trimNulls(decodeUtf16(body.subarray(2), true));
    }
    if (body[0] === 0xfe && body[1] === 0xff) {
      return trimNulls(decodeUtf16(body.subarray(2), false));
    }
    return trimNulls(decodeUtf16(body, false));
  }
  if (tag === "JIS") return trimNulls(decodeLatin1(body));
  const utf8 = decodeUtf8(body);
  const replacementChar = String.fromCharCode(0xfffd);
  if (!utf8.includes(replacementChar)) return trimNulls(utf8);
  return trimNulls(decodeLatin1(body));
}

/** Windows `XP*` EXIF tags store UCS-2LE inside a byte array. */
export function decodeXpString(bytes: Uint8Array): string {
  return trimNulls(decodeUtf16(bytes, true));
}

/**
 * Drops C0/C1 control characters so untrusted metadata is safe to render.
 * Newlines and tabs survive because generator prompts rely on them.
 */
export function sanitizeForDisplay(text: string, maxLength = 4000): string {
  let out = "";
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code === 9 || code === 10) {
      out += text[index];
      continue;
    }
    if (code === 13) {
      // Normalise CRLF to a single LF.
      if (text.charCodeAt(index + 1) !== 10) out += "\n";
      continue;
    }
    if (code < 32 || (code >= 127 && code <= 159)) continue;
    out += text[index];
  }
  const trimmed = out.trim();
  return trimmed.length > maxLength
    ? `${trimmed.slice(0, maxLength)}${String.fromCharCode(0x2026)}`
    : trimmed;
}

/** Heuristic used to decide whether a blob of bytes is worth reading as text. */
export function looksLikeText(bytes: Uint8Array, sampleSize = 512): boolean {
  const limit = Math.min(bytes.length, sampleSize);
  if (limit === 0) return false;
  let printable = 0;
  for (let index = 0; index < limit; index += 1) {
    const byte = bytes[index];
    if (
      byte === 0x09 ||
      byte === 0x0a ||
      byte === 0x0d ||
      (byte >= 0x20 && byte < 0x7f) ||
      (byte >= 0xc2 && byte <= 0xf4)
    ) {
      printable += 1;
    }
  }
  return printable / limit > 0.85;
}
