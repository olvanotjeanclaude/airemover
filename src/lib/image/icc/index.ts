import type { IccSummary } from "@/types/metadata";
import { ByteReader, asciiOf } from "../utils/bytes";
import { decodeLatin1, decodeUtf16, trimNulls } from "../utils/text";

const ICC_SIGNATURE = "acsp";

const DEVICE_CLASS_LABELS: Readonly<Record<string, string>> = {
  scnr: "Input device",
  mntr: "Display device",
  prtr: "Output device",
  link: "DeviceLink",
  spac: "Colour space",
  abst: "Abstract",
  nmcl: "Named colour",
};

const COLOR_SPACE_LABELS: Readonly<Record<string, string>> = {
  "RGB ": "RGB",
  "GRAY": "Grayscale",
  "CMYK": "CMYK",
  "Lab ": "CIELAB",
  "XYZ ": "CIEXYZ",
  "YCbr": "YCbCr",
  "CMY ": "CMY",
};

/** Verifies the 128-byte header signature before trusting any offsets. */
export function isIccProfile(bytes: Uint8Array): boolean {
  return bytes.length >= 132 && asciiOf(bytes.subarray(36, 40)) === ICC_SIGNATURE;
}

export function summarizeIcc(bytes: Uint8Array): IccSummary {
  const summary: IccSummary = { bytes: bytes.length };
  if (!isIccProfile(bytes)) return summary;

  const reader = new ByteReader(bytes, 4);
  const cmm = trimNulls(reader.ascii(4));
  const major = reader.u8();
  const minor = reader.u8();
  reader.skip(2);
  const deviceClass = reader.ascii(4);
  const colorSpace = reader.ascii(4);

  summary.cmm = cmm || undefined;
  summary.version = `${major}.${minor >> 4}`;
  summary.deviceClass = DEVICE_CLASS_LABELS[deviceClass] ?? trimNulls(deviceClass);
  summary.colorSpace = COLOR_SPACE_LABELS[colorSpace] ?? trimNulls(colorSpace);
  summary.description = readProfileDescription(bytes);

  return summary;
}

function readProfileDescription(bytes: Uint8Array): string | undefined {
  try {
    const reader = new ByteReader(bytes, 128);
    const tagCount = reader.u32();
    if (tagCount > 512) return undefined;
    for (let index = 0; index < tagCount; index += 1) {
      if (!reader.has(12)) return undefined;
      const signature = reader.ascii(4);
      const offset = reader.u32();
      const size = reader.u32();
      if (signature !== "desc") continue;
      if (offset + size > bytes.length || size < 12) return undefined;
      return decodeTextTag(bytes.subarray(offset, offset + size));
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function decodeTextTag(tag: Uint8Array): string | undefined {
  const type = asciiOf(tag.subarray(0, 4));

  if (type === "desc") {
    // ICC v2 textDescriptionType: 4 sig + 4 reserved + 4 ASCII length.
    const view = new DataView(tag.buffer, tag.byteOffset, tag.byteLength);
    const length = view.getUint32(8);
    if (length === 0 || 12 + length > tag.length) return undefined;
    return trimNulls(decodeLatin1(tag.subarray(12, 12 + length))) || undefined;
  }

  if (type === "mluc") {
    // ICC v4 multiLocalizedUnicodeType: records of UTF-16BE strings.
    const view = new DataView(tag.buffer, tag.byteOffset, tag.byteLength);
    const recordCount = view.getUint32(8);
    if (recordCount === 0) return undefined;
    const length = view.getUint32(20);
    const offset = view.getUint32(24);
    if (offset + length > tag.length || length === 0) return undefined;
    return (
      trimNulls(decodeUtf16(tag.subarray(offset, offset + length), false)) ||
      undefined
    );
  }

  if (type === "text") {
    return trimNulls(decodeLatin1(tag.subarray(8))) || undefined;
  }

  return undefined;
}
