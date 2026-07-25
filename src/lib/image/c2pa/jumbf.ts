import { ByteReader, asciiOf, indexOfAscii } from "../utils/bytes";
import { decodeLatin1, trimNulls } from "../utils/text";

/**
 * Minimal JUMBF (ISO/IEC 19566-5) reader. C2PA manifest stores are JUMBF
 * superboxes, so walking the box tree is enough to report what a manifest
 * claims without validating any signature.
 */

/** UUID D8FEC3D6-1B0E-483C-9297-58 28 87 7E C4 81, the C2PA BMFF box type. */
export const C2PA_BMFF_UUID = new Uint8Array([
  0xd8, 0xfe, 0xc3, 0xd6, 0x1b, 0x0e, 0x48, 0x3c, 0x92, 0x97, 0x58, 0x28, 0x87,
  0x7e, 0xc4, 0x81,
]);

const JUMBF_SUPERBOX = "jumb";
const JUMBF_DESCRIPTION = "jumd";
const MAX_BOX_DEPTH = 12;

export interface JumbfBox {
  type: string;
  label?: string;
  size: number;
  children: JumbfBox[];
  payload?: Uint8Array;
}

export interface JumbfScan {
  boxes: JumbfBox[];
  labels: string[];
  claimGenerator?: string;
  hasSignature: boolean;
  /** True when the byte stream parsed cleanly as a JUMBF tree. */
  valid: boolean;
}

export function isC2paUuid(bytes: Uint8Array, at = 0): boolean {
  if (at + 16 > bytes.length) return false;
  for (let index = 0; index < 16; index += 1) {
    if (bytes[at + index] !== C2PA_BMFF_UUID[index]) return false;
  }
  return true;
}

/** Cheap structural test used to classify unknown blobs as C2PA. */
export function looksLikeJumbf(bytes: Uint8Array): boolean {
  if (bytes.length < 16) return false;
  // A JUMBF superbox starts with a 4-byte length followed by "jumb".
  if (asciiOf(bytes.subarray(4, 8)) === JUMBF_SUPERBOX) return true;
  // Some writers prepend padding, so also accept an early jumb/jumd pair.
  const head = bytes.subarray(0, 128);
  const superbox = indexOfAscii(head, JUMBF_SUPERBOX);
  if (superbox < 0) return false;
  return indexOfAscii(head, JUMBF_DESCRIPTION) > superbox;
}

export function scanJumbf(bytes: Uint8Array): JumbfScan {
  const scan: JumbfScan = {
    boxes: [],
    labels: [],
    hasSignature: false,
    valid: false,
  };
  try {
    scan.boxes = readBoxes(bytes, 0, bytes.length, 0, scan);
    scan.valid = scan.boxes.length > 0;
  } catch {
    scan.valid = false;
  }
  scan.hasSignature = scan.labels.some((label) => label.includes("signature"));
  scan.claimGenerator = findClaimGenerator(bytes);
  return scan;
}

function readBoxes(
  bytes: Uint8Array,
  start: number,
  end: number,
  depth: number,
  scan: JumbfScan,
): JumbfBox[] {
  if (depth > MAX_BOX_DEPTH) return [];
  const boxes: JumbfBox[] = [];
  const reader = new ByteReader(bytes, start);

  while (reader.offset + 8 <= end) {
    const boxStart = reader.offset;
    const declaredSize = reader.u32();
    const type = reader.ascii(4);
    let size = declaredSize;
    if (size === 0) {
      size = end - boxStart;
    } else if (size === 1) {
      if (reader.offset + 8 > end) break;
      size = reader.u64();
    }
    if (size < 8 || boxStart + size > end) break;

    const contentStart = reader.offset;
    const contentEnd = boxStart + size;
    const box: JumbfBox = { type, size, children: [] };

    if (type === JUMBF_SUPERBOX) {
      box.children = readBoxes(bytes, contentStart, contentEnd, depth + 1, scan);
      const description = box.children.find(
        (child) => child.type === JUMBF_DESCRIPTION,
      );
      if (description?.label) {
        box.label = description.label;
        scan.labels.push(description.label);
      }
    } else if (type === JUMBF_DESCRIPTION) {
      box.label = readDescriptionLabel(bytes, contentStart, contentEnd);
    } else {
      box.payload = bytes.subarray(contentStart, contentEnd);
    }

    boxes.push(box);
    reader.offset = contentEnd;
  }

  return boxes;
}

/**
 * A description box holds a 16-byte type UUID, a toggle byte, and — when bit 1
 * of the toggles is set — a NUL-terminated label.
 */
function readDescriptionLabel(
  bytes: Uint8Array,
  start: number,
  end: number,
): string | undefined {
  if (start + 17 > end) return undefined;
  const toggles = bytes[start + 16];
  if ((toggles & 0x02) === 0) return undefined;
  let cursor = start + 17;
  while (cursor < end && bytes[cursor] !== 0) cursor += 1;
  const label = trimNulls(decodeLatin1(bytes.subarray(start + 17, cursor)));
  return label || undefined;
}

/**
 * Claims are CBOR maps. Rather than pull in a decoder, locate the
 * `claim_generator` key and read the CBOR text string that follows it, which is
 * enough to name the tool that signed the image.
 */
function findClaimGenerator(bytes: Uint8Array): string | undefined {
  for (const key of ["claim_generator_info", "claim_generator"]) {
    const at = indexOfAscii(bytes, key);
    if (at < 0) continue;
    const value = readCborTextString(bytes, at + key.length);
    if (value) return value;
  }
  return undefined;
}

function isPrintableAscii(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x20 || code > 0x7e) return false;
  }
  return text.length > 0;
}

function readCborTextString(bytes: Uint8Array, from: number): string | undefined {
  // Skip container headers (arrays, maps, a nested "name" key) up to a limit.
  const limit = Math.min(from + 24, bytes.length);
  for (let cursor = from; cursor < limit; cursor += 1) {
    const initial = bytes[cursor];
    if (initial >> 5 !== 3) continue; // major type 3 = text string
    const additional = initial & 0x1f;
    let length = additional;
    let dataStart = cursor + 1;
    if (additional === 24) {
      if (dataStart >= bytes.length) return undefined;
      length = bytes[dataStart];
      dataStart += 1;
    } else if (additional === 25) {
      if (dataStart + 1 >= bytes.length) return undefined;
      length = (bytes[dataStart] << 8) | bytes[dataStart + 1];
      dataStart += 2;
    } else if (additional >= 26) {
      return undefined;
    }
    if (length < 2 || length > 200 || dataStart + length > bytes.length) continue;
    const text = decodeLatin1(bytes.subarray(dataStart, dataStart + length));
    if (isPrintableAscii(text) && text.trim().length > 1) return text.trim();
  }
  return undefined;
}
