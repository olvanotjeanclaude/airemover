import { ByteReader, ByteWriter, asciiOf } from "../utils/bytes";

export class BmffParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BmffParseError";
  }
}

export interface BmffBox {
  type: string;
  /** Offset of the size field. */
  offset: number;
  /** Total bytes the box occupies. */
  size: number;
  /** Bytes before the payload: 8, 16 for large sizes, plus 16 for a uuid. */
  headerSize: number;
  payloadOffset: number;
  payloadSize: number;
  /** Present for `uuid` boxes. */
  uuid?: Uint8Array;
  /** Full-box header, when the type declares one. */
  version?: number;
  flags?: number;
  children?: BmffBox[];
}

/** Boxes whose payload is a list of further boxes. */
const CONTAINER_TYPES = new Set([
  "moov",
  "trak",
  "mdia",
  "minf",
  "stbl",
  "dinf",
  "edts",
  "udta",
  "iprp",
  "ipco",
  "sinf",
  "schi",
  "moof",
  "traf",
  "mvex",
  "grpl",
]);

/** Container boxes that begin with a 4-byte version/flags header. */
const FULL_CONTAINER_TYPES = new Set(["meta", "iref"]);

const MAX_DEPTH = 8;

export function parseBoxes(
  bytes: Uint8Array,
  start = 0,
  end = bytes.length,
  depth = 0,
): BmffBox[] {
  const boxes: BmffBox[] = [];
  if (depth > MAX_DEPTH) return boxes;
  const reader = new ByteReader(bytes, start);

  while (reader.offset + 8 <= end) {
    const offset = reader.offset;
    let size = reader.u32();
    const type = reader.ascii(4);
    let headerSize = 8;

    if (size === 1) {
      if (reader.offset + 8 > end) break;
      size = reader.u64();
      headerSize = 16;
    } else if (size === 0) {
      size = end - offset;
    }

    if (size < headerSize || offset + size > end) break;

    let uuid: Uint8Array | undefined;
    if (type === "uuid") {
      if (reader.offset + 16 > end) break;
      uuid = reader.take(16);
      headerSize += 16;
    }

    const payloadOffset = offset + headerSize;
    const payloadSize = size - headerSize;
    const box: BmffBox = {
      type,
      offset,
      size,
      headerSize,
      payloadOffset,
      payloadSize,
      uuid,
    };

    if (CONTAINER_TYPES.has(type)) {
      box.children = parseBoxes(bytes, payloadOffset, offset + size, depth + 1);
    } else if (FULL_CONTAINER_TYPES.has(type) && payloadSize >= 4) {
      const header = readFullBoxHeader(bytes, payloadOffset);
      box.version = header.version;
      box.flags = header.flags;
      box.children = parseBoxes(bytes, payloadOffset + 4, offset + size, depth + 1);
    }

    boxes.push(box);
    reader.offset = offset + size;
  }

  return boxes;
}

export function readFullBoxHeader(
  bytes: Uint8Array,
  at: number,
): { version: number; flags: number } {
  return {
    version: bytes[at],
    flags: (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3],
  };
}

export function findBox(
  boxes: readonly BmffBox[],
  type: string,
): BmffBox | undefined {
  return boxes.find((box) => box.type === type);
}

export function findAllBoxes(
  boxes: readonly BmffBox[],
  type: string,
): BmffBox[] {
  return boxes.filter((box) => box.type === type);
}

export function boxPayload(bytes: Uint8Array, box: BmffBox): Uint8Array {
  return bytes.subarray(box.payloadOffset, box.payloadOffset + box.payloadSize);
}

/** Serialises a box, choosing the 64-bit header only when it is required. */
export function writeBox(type: string, payload: Uint8Array): Uint8Array {
  const writer = new ByteWriter(payload.length + 8);
  writer.u32(payload.length + 8);
  writer.ascii(type);
  writer.raw(payload);
  return writer.finish();
}

export function writeFullBox(
  type: string,
  version: number,
  flags: number,
  payload: Uint8Array,
): Uint8Array {
  const writer = new ByteWriter(payload.length + 12);
  writer.u32(payload.length + 12);
  writer.ascii(type);
  writer.u8(version);
  writer.u24(flags, false);
  writer.raw(payload);
  return writer.finish();
}

/** Compatible brands declared by the `ftyp` box. */
export function readBrands(bytes: Uint8Array, ftyp: BmffBox): string[] {
  const brands: string[] = [];
  const payload = boxPayload(bytes, ftyp);
  if (payload.length >= 4) brands.push(asciiOf(payload.subarray(0, 4)));
  for (let offset = 8; offset + 4 <= payload.length; offset += 4) {
    brands.push(asciiOf(payload.subarray(offset, offset + 4)));
  }
  return brands;
}
