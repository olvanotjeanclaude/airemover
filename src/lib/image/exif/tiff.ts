import { ByteReader, ByteWriter } from "../utils/bytes";
import { decodeLatin1, trimNulls } from "../utils/text";
import {
  OFFSET_TAG_PAIRS,
  SUB_IFD_TAGS,
  TAG,
  TIFF_TYPE,
  TIFF_TYPE_SIZES,
} from "./constants";

export class TiffParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TiffParseError";
  }
}

export class TiffUnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TiffUnsupportedError";
  }
}

export type IfdKind = "ifd0" | "page" | "exif" | "gps" | "interop" | "sub";

export interface TiffEntry {
  tag: number;
  type: number;
  count: number;
  /** Raw value bytes exactly as stored in the source. */
  value: Uint8Array;
  /** Offset of the value inside the TIFF payload; -1 when stored inline. */
  valueOffset: number;
  inline: boolean;
  /** Nested directories for Exif / GPS / Interop / SubIFDs pointers. */
  subIfds?: TiffIfd[];
  /**
   * Relocatable payloads for offset tags (strips, tiles, embedded thumbnails).
   * When present the writer re-emits these blocks and rewrites the offsets,
   * which is what lets a TIFF be rebuilt without touching pixel data.
   */
  dataBlocks?: Uint8Array[];
}

export interface TiffIfd {
  kind: IfdKind;
  /** Offset in the source payload; -1 for directories built in memory. */
  offset: number;
  entries: TiffEntry[];
}

export interface TiffTree {
  littleEndian: boolean;
  /** The top-level chain: IFD0, then IFD1 (thumbnail or next page), and so on. */
  ifds: TiffIfd[];
  warnings: string[];
  /**
   * Highest byte touched while parsing, i.e. the real extent of the payload.
   * JPEG APP1 segments state their own length, but standalone TIFFs do not.
   */
  extent: number;
}

const MAX_IFD_DEPTH = 8;
const MAX_IFD_ENTRIES = 4096;
const MAX_CHAIN_LENGTH = 64;

/**
 * Parses a TIFF payload. `payload` must begin at the byte order marker, which
 * is also the origin all internal offsets are measured from.
 */
export function parseTiff(payload: Uint8Array): TiffTree {
  if (payload.length < 8) {
    throw new TiffParseError("TIFF payload is shorter than its 8-byte header");
  }

  const order = decodeLatin1(payload.subarray(0, 2));
  let littleEndian: boolean;
  if (order === "II") littleEndian = true;
  else if (order === "MM") littleEndian = false;
  else throw new TiffParseError(`Unknown TIFF byte order marker "${order}"`);

  const reader = new ByteReader(payload, 2);
  const magic = reader.u16(littleEndian);
  if (magic === 43) {
    throw new TiffUnsupportedError("BigTIFF (magic 43) is not supported");
  }
  if (magic !== 42) {
    throw new TiffParseError(`Unexpected TIFF magic number ${magic}`);
  }

  const firstIfdOffset = reader.u32(littleEndian);
  const warnings: string[] = [];
  const visited = new Set<number>();
  const context: ParseContext = {
    payload,
    littleEndian,
    warnings,
    visited,
    extent: 8,
  };

  const ifds: TiffIfd[] = [];
  let nextOffset = firstIfdOffset;
  let guard = 0;
  while (nextOffset !== 0 && guard < MAX_CHAIN_LENGTH) {
    const parsed = readIfd(context, nextOffset, guard === 0 ? "ifd0" : "page", 0);
    if (!parsed) break;
    ifds.push(parsed.ifd);
    nextOffset = parsed.nextOffset;
    guard += 1;
  }
  if (guard >= MAX_CHAIN_LENGTH) {
    warnings.push("TIFF directory chain was truncated after 64 directories");
  }
  if (ifds.length === 0) {
    throw new TiffParseError("TIFF payload contains no readable directory");
  }

  return { littleEndian, ifds, warnings, extent: context.extent };
}

interface ParseContext {
  payload: Uint8Array;
  littleEndian: boolean;
  warnings: string[];
  visited: Set<number>;
  extent: number;
}

function readIfd(
  context: ParseContext,
  offset: number,
  kind: IfdKind,
  depth: number,
): { ifd: TiffIfd; nextOffset: number } | null {
  const { payload, littleEndian, warnings } = context;

  if (depth > MAX_IFD_DEPTH) {
    warnings.push("Nested EXIF directories exceeded the depth limit");
    return null;
  }
  if (offset < 8 || offset + 2 > payload.length) {
    warnings.push(`Directory offset ${offset} points outside the payload`);
    return null;
  }
  if (context.visited.has(offset)) {
    warnings.push(`Directory at ${offset} is referenced twice; the loop was cut`);
    return null;
  }
  context.visited.add(offset);

  const reader = new ByteReader(payload, offset);
  let count: number;
  try {
    count = reader.u16(littleEndian);
  } catch {
    warnings.push(`Directory at ${offset} is truncated`);
    return null;
  }

  if (count > MAX_IFD_ENTRIES) {
    warnings.push(`Directory at ${offset} declares ${count} entries; ignored`);
    return null;
  }

  const entries: TiffEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    if (!reader.has(12)) {
      warnings.push(`Directory at ${offset} ends mid-entry; the rest was dropped`);
      break;
    }
    const tag = reader.u16(littleEndian);
    const type = reader.u16(littleEndian);
    const valueCount = reader.u32(littleEndian);
    const fieldOffset = reader.offset;
    const field = reader.take(4);

    const unitSize = TIFF_TYPE_SIZES[type];
    if (!unitSize) {
      warnings.push(
        `Tag 0x${tag.toString(16)} uses unknown field type ${type} and was dropped`,
      );
      continue;
    }
    const byteLength = unitSize * valueCount;
    if (byteLength > payload.length) {
      warnings.push(
        `Tag 0x${tag.toString(16)} declares ${byteLength} bytes, more than the payload holds`,
      );
      continue;
    }

    let value: Uint8Array;
    let valueOffset: number;
    let inline: boolean;
    if (byteLength <= 4) {
      value = field.subarray(0, byteLength);
      valueOffset = fieldOffset;
      inline = true;
    } else {
      const dataOffset = readU32(field, 0, littleEndian);
      if (dataOffset + byteLength > payload.length) {
        warnings.push(
          `Tag 0x${tag.toString(16)} points past the end of the payload and was dropped`,
        );
        continue;
      }
      value = payload.subarray(dataOffset, dataOffset + byteLength);
      valueOffset = dataOffset;
      inline = false;
      context.extent = Math.max(context.extent, dataOffset + byteLength);
    }

    entries.push({ tag, type, count: valueCount, value, valueOffset, inline });
  }

  let nextOffset = 0;
  if (reader.has(4)) {
    nextOffset = reader.u32(littleEndian);
    context.extent = Math.max(context.extent, reader.offset);
  }

  const ifd: TiffIfd = { kind, offset, entries };
  resolveSubIfds(context, ifd, depth);
  resolveDataBlocks(context, ifd);
  return { ifd, nextOffset };
}

function resolveSubIfds(
  context: ParseContext,
  ifd: TiffIfd,
  depth: number,
): void {
  for (const entry of ifd.entries) {
    if (!SUB_IFD_TAGS.has(entry.tag)) continue;
    const offsets = readNumbers(entry, context.littleEndian);
    const kind = subIfdKind(entry.tag);
    const children: TiffIfd[] = [];
    for (const childOffset of offsets) {
      const parsed = readIfd(context, childOffset, kind, depth + 1);
      if (parsed) children.push(parsed.ifd);
    }
    if (children.length > 0) entry.subIfds = children;
  }
}

function subIfdKind(tag: number): IfdKind {
  if (tag === TAG.ExifIFDPointer) return "exif";
  if (tag === TAG.GPSIFDPointer) return "gps";
  if (tag === TAG.InteroperabilityIFDPointer) return "interop";
  return "sub";
}

function resolveDataBlocks(context: ParseContext, ifd: TiffIfd): void {
  const byTag = new Map<number, TiffEntry>();
  for (const entry of ifd.entries) byTag.set(entry.tag, entry);

  for (const [offsetTagText, lengthTag] of Object.entries(OFFSET_TAG_PAIRS)) {
    const offsetTag = Number(offsetTagText);
    const offsetEntry = byTag.get(offsetTag);
    const lengthEntry = byTag.get(lengthTag);
    if (!offsetEntry || !lengthEntry) continue;

    const offsets = readNumbers(offsetEntry, context.littleEndian);
    const lengths = readNumbers(lengthEntry, context.littleEndian);
    if (offsets.length === 0 || offsets.length !== lengths.length) {
      if (offsets.length !== lengths.length) {
        context.warnings.push(
          `Offset tag 0x${offsetTag.toString(16)} has ${offsets.length} entries but ${lengths.length} lengths`,
        );
      }
      continue;
    }

    const blocks: Uint8Array[] = [];
    let usable = true;
    for (let index = 0; index < offsets.length; index += 1) {
      const start = offsets[index];
      const size = lengths[index];
      if (start < 0 || size < 0 || start + size > context.payload.length) {
        context.warnings.push(
          `Pixel data block ${index} of tag 0x${offsetTag.toString(16)} is out of range`,
        );
        usable = false;
        break;
      }
      blocks.push(context.payload.subarray(start, start + size));
      context.extent = Math.max(context.extent, start + size);
    }
    if (usable) offsetEntry.dataBlocks = blocks;
  }
}

function readU32(bytes: Uint8Array, at: number, littleEndian: boolean): number {
  return littleEndian
    ? (bytes[at] |
        (bytes[at + 1] << 8) |
        (bytes[at + 2] << 16) |
        (bytes[at + 3] << 24)) >>>
        0
    : ((bytes[at] << 24) |
        (bytes[at + 1] << 16) |
        (bytes[at + 2] << 8) |
        bytes[at + 3]) >>>
        0;
}

/** Reads an entry's value as numbers. Rationals collapse to their quotient. */
export function readNumbers(entry: TiffEntry, littleEndian: boolean): number[] {
  const out: number[] = [];
  const { value, type, count } = entry;
  const view = new DataView(value.buffer, value.byteOffset, value.byteLength);
  const unitSize = TIFF_TYPE_SIZES[type] ?? 0;
  if (unitSize === 0) return out;
  const readable = Math.min(count, Math.floor(value.length / unitSize));

  for (let index = 0; index < readable; index += 1) {
    const at = index * unitSize;
    switch (type) {
      case TIFF_TYPE.BYTE:
      case TIFF_TYPE.UNDEFINED:
        out.push(view.getUint8(at));
        break;
      case TIFF_TYPE.SBYTE:
        out.push(view.getInt8(at));
        break;
      case TIFF_TYPE.SHORT:
        out.push(view.getUint16(at, littleEndian));
        break;
      case TIFF_TYPE.SSHORT:
        out.push(view.getInt16(at, littleEndian));
        break;
      case TIFF_TYPE.LONG:
      case TIFF_TYPE.IFD:
        out.push(view.getUint32(at, littleEndian));
        break;
      case TIFF_TYPE.SLONG:
        out.push(view.getInt32(at, littleEndian));
        break;
      case TIFF_TYPE.RATIONAL: {
        const numerator = view.getUint32(at, littleEndian);
        const denominator = view.getUint32(at + 4, littleEndian);
        out.push(denominator === 0 ? 0 : numerator / denominator);
        break;
      }
      case TIFF_TYPE.SRATIONAL: {
        const numerator = view.getInt32(at, littleEndian);
        const denominator = view.getInt32(at + 4, littleEndian);
        out.push(denominator === 0 ? 0 : numerator / denominator);
        break;
      }
      case TIFF_TYPE.FLOAT:
        out.push(view.getFloat32(at, littleEndian));
        break;
      case TIFF_TYPE.DOUBLE:
        out.push(view.getFloat64(at, littleEndian));
        break;
      default:
        break;
    }
  }
  return out;
}

/** Reads the numerator/denominator pairs of a RATIONAL entry without dividing. */
export function readRationals(
  entry: TiffEntry,
  littleEndian: boolean,
): { numerator: number; denominator: number }[] {
  if (entry.type !== TIFF_TYPE.RATIONAL && entry.type !== TIFF_TYPE.SRATIONAL) {
    return [];
  }
  const view = new DataView(
    entry.value.buffer,
    entry.value.byteOffset,
    entry.value.byteLength,
  );
  const pairs: { numerator: number; denominator: number }[] = [];
  const readable = Math.floor(entry.value.length / 8);
  const signed = entry.type === TIFF_TYPE.SRATIONAL;
  for (let index = 0; index < readable; index += 1) {
    const at = index * 8;
    pairs.push({
      numerator: signed
        ? view.getInt32(at, littleEndian)
        : view.getUint32(at, littleEndian),
      denominator: signed
        ? view.getInt32(at + 4, littleEndian)
        : view.getUint32(at + 4, littleEndian),
    });
  }
  return pairs;
}

export function readAscii(entry: TiffEntry): string {
  return trimNulls(decodeLatin1(entry.value));
}

export function findEntry(ifd: TiffIfd, tag: number): TiffEntry | undefined {
  return ifd.entries.find((entry) => entry.tag === tag);
}

export function findSubIfd(tree: TiffTree, kind: IfdKind): TiffIfd | undefined {
  for (const ifd of tree.ifds) {
    if (ifd.kind === kind) return ifd;
    for (const entry of ifd.entries) {
      for (const child of entry.subIfds ?? []) {
        if (child.kind === kind) return child;
      }
    }
  }
  return undefined;
}

/** Total bytes an entry occupies: its 12-byte record plus any external value. */
export function entrySize(entry: TiffEntry): number {
  let size = 12;
  if (!entry.inline) size += entry.value.length;
  for (const block of entry.dataBlocks ?? []) size += block.length;
  for (const child of entry.subIfds ?? []) size += ifdSize(child);
  return size;
}

export function ifdSize(ifd: TiffIfd): number {
  let size = 6;
  for (const entry of ifd.entries) size += entrySize(entry);
  return size;
}

export function treeSize(tree: TiffTree): number {
  let size = 8;
  for (const ifd of tree.ifds) size += ifdSize(ifd);
  return size;
}

export function countEntries(tree: TiffTree): number {
  let total = 0;
  const walk = (ifd: TiffIfd): void => {
    total += ifd.entries.length;
    for (const entry of ifd.entries) {
      for (const child of entry.subIfds ?? []) walk(child);
    }
  };
  for (const ifd of tree.ifds) walk(ifd);
  return total;
}

/**
 * Serialises a directory tree back into a TIFF payload.
 *
 * Offsets are unknown while the directory records are being written, so every
 * value field is emitted as a placeholder and back-patched once its data has
 * been laid down. Offset tags (strips, tiles, thumbnails) are always promoted
 * to LONG so a relocated block can never overflow a SHORT field.
 */
export function writeTiff(tree: TiffTree): Uint8Array {
  const { littleEndian } = tree;
  const writer = new ByteWriter(4096);
  writer.ascii(littleEndian ? "II" : "MM");
  writer.u16(42, littleEndian);
  const firstIfdField = writer.length;
  writer.u32(0, littleEndian);

  let previousNextField = firstIfdField;
  for (const ifd of tree.ifds) {
    align(writer);
    const written = emitIfd(writer, ifd, littleEndian);
    writer.patchU32(previousNextField, written.offset, littleEndian);
    previousNextField = written.nextField;
  }
  writer.patchU32(previousNextField, 0, littleEndian);

  return writer.finish();
}

interface EmittedIfd {
  offset: number;
  nextField: number;
}

interface PendingEntry {
  entry: TiffEntry;
  fieldOffset: number;
}

function emitIfd(
  writer: ByteWriter,
  ifd: TiffIfd,
  littleEndian: boolean,
): EmittedIfd {
  const entries = [...ifd.entries].sort((a, b) => a.tag - b.tag);
  const offset = writer.length;
  writer.u16(entries.length, littleEndian);

  const pending: PendingEntry[] = [];
  for (const entry of entries) {
    const isRelocatable = Boolean(entry.dataBlocks);
    const type = isRelocatable ? TIFF_TYPE.LONG : entry.type;
    const count = isRelocatable ? entry.dataBlocks!.length : entry.count;
    writer.u16(entry.tag, littleEndian);
    writer.u16(type, littleEndian);
    writer.u32(count, littleEndian);
    pending.push({ entry, fieldOffset: writer.length });
    writer.u32(0, littleEndian);
  }

  const nextField = writer.length;
  writer.u32(0, littleEndian);

  // Phase 1: inline values and plain external blobs.
  for (const { entry, fieldOffset } of pending) {
    if (entry.dataBlocks || entry.subIfds) continue;
    if (entry.inline) {
      writer.patchRaw(fieldOffset, entry.value);
      continue;
    }
    align(writer);
    const valueOffset = writer.length;
    writer.raw(entry.value);
    writer.patchU32(fieldOffset, valueOffset, littleEndian);
  }

  // Phase 2: relocatable data blocks, with their offset array rebuilt.
  for (const { entry, fieldOffset } of pending) {
    const blocks = entry.dataBlocks;
    if (!blocks) continue;
    const newOffsets: number[] = [];
    for (const block of blocks) {
      align(writer);
      newOffsets.push(writer.length);
      writer.raw(block);
    }
    if (newOffsets.length === 1) {
      writer.patchU32(fieldOffset, newOffsets[0], littleEndian);
    } else {
      align(writer);
      const arrayOffset = writer.length;
      for (const value of newOffsets) writer.u32(value, littleEndian);
      writer.patchU32(fieldOffset, arrayOffset, littleEndian);
    }
  }

  // Phase 3: nested directories, written after everything they might follow.
  for (const { entry, fieldOffset } of pending) {
    const children = entry.subIfds;
    if (!children) continue;
    const childOffsets: number[] = [];
    for (const child of children) {
      align(writer);
      const written = emitIfd(writer, child, littleEndian);
      writer.patchU32(written.nextField, 0, littleEndian);
      childOffsets.push(written.offset);
    }
    if (childOffsets.length === 1) {
      writer.patchU32(fieldOffset, childOffsets[0], littleEndian);
    } else {
      align(writer);
      const arrayOffset = writer.length;
      for (const value of childOffsets) writer.u32(value, littleEndian);
      writer.patchU32(fieldOffset, arrayOffset, littleEndian);
    }
  }

  return { offset, nextField };
}

function align(writer: ByteWriter): void {
  if (writer.length % 2 === 1) writer.u8(0);
}

/** Builds a minimal single-tag directory, used to keep orientation alive. */
export function buildMinimalTiff(
  entries: { tag: number; type: number; count: number; value: Uint8Array }[],
  littleEndian = false,
): Uint8Array {
  const ifd: TiffIfd = {
    kind: "ifd0",
    offset: -1,
    entries: entries.map((entry) => ({
      ...entry,
      valueOffset: -1,
      inline: entry.value.length <= 4,
    })),
  };
  return writeTiff({ littleEndian, ifds: [ifd], warnings: [], extent: 0 });
}
