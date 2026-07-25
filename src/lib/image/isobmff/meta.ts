import { ByteReader, ByteWriter, asciiOf } from "../utils/bytes";
import { decodeLatin1, trimNulls } from "../utils/text";
import {
  boxPayload,
  findBox,
  parseBoxes,
  readFullBoxHeader,
  writeFullBox,
  type BmffBox,
} from "./boxes";

export interface ItemExtent {
  /** Offset as stored in the source file, before relocation. */
  offset: number;
  length: number;
}

export interface ItemLocation {
  itemId: number;
  /** 0 = file offset, 1 = offset inside `idat`, 2 = offset inside another item. */
  constructionMethod: number;
  dataReferenceIndex: number;
  baseOffset: number;
  extents: ItemExtent[];
}

export interface ItemLocationTable {
  version: number;
  flags: number;
  items: ItemLocation[];
}

export interface ItemInfoEntry {
  itemId: number;
  protectionIndex: number;
  itemType: string;
  itemName: string;
  contentType?: string;
  /** The raw `infe` box, re-emitted verbatim for kept items. */
  raw: Uint8Array;
}

export interface ItemInfoTable {
  version: number;
  flags: number;
  entries: ItemInfoEntry[];
}

export interface ItemReference {
  type: string;
  fromItemId: number;
  toItemIds: number[];
}

export interface ItemReferenceTable {
  version: number;
  flags: number;
  references: ItemReference[];
}

export interface PropertyAssociation {
  itemId: number;
  /** Each association is a property index plus its "essential" bit. */
  associations: { essential: boolean; propertyIndex: number }[];
}

export interface PropertyAssociationTable {
  version: number;
  flags: number;
  entries: PropertyAssociation[];
}

function readSized(reader: ByteReader, byteCount: number): number {
  if (byteCount === 0) return 0;
  if (byteCount === 4) return reader.u32();
  if (byteCount === 8) return reader.u64();
  let value = 0;
  for (let index = 0; index < byteCount; index += 1) {
    value = value * 256 + reader.u8();
  }
  return value;
}

export function parseItemLocation(
  bytes: Uint8Array,
  box: BmffBox,
): ItemLocationTable {
  const payload = boxPayload(bytes, box);
  const { version, flags } = readFullBoxHeader(payload, 0);
  const reader = new ByteReader(payload, 4);

  const packedSizes = reader.u8();
  const offsetSize = packedSizes >> 4;
  const lengthSize = packedSizes & 0x0f;
  const packedBase = reader.u8();
  const baseOffsetSize = packedBase >> 4;
  const indexSize = version >= 1 ? packedBase & 0x0f : 0;

  const itemCount = version < 2 ? reader.u16() : reader.u32();
  const items: ItemLocation[] = [];

  for (let index = 0; index < itemCount; index += 1) {
    const itemId = version < 2 ? reader.u16() : reader.u32();
    let constructionMethod = 0;
    if (version >= 1) {
      constructionMethod = reader.u16() & 0x0f;
    }
    const dataReferenceIndex = reader.u16();
    const baseOffset = readSized(reader, baseOffsetSize);
    const extentCount = reader.u16();
    const extents: ItemExtent[] = [];
    for (let extentIndex = 0; extentIndex < extentCount; extentIndex += 1) {
      if (indexSize > 0) readSized(reader, indexSize);
      const offset = readSized(reader, offsetSize);
      const length = readSized(reader, lengthSize);
      extents.push({ offset, length });
    }
    items.push({ itemId, constructionMethod, dataReferenceIndex, baseOffset, extents });
  }

  return { version, flags, items };
}

/**
 * Folds `base_offset` into each extent so every offset stands on its own. The
 * rewritten table declares `base_offset_size = 0`, so carrying the base
 * separately would silently shift every extent.
 */
export function normalizeItemLocations(
  items: readonly ItemLocation[],
): ItemLocation[] {
  return items.map((item) =>
    item.baseOffset === 0
      ? item
      : {
          ...item,
          baseOffset: 0,
          extents: item.extents.map((extent) => ({
            offset: extent.offset + item.baseOffset,
            length: extent.length,
          })),
        },
  );
}

/**
 * Emits an `iloc` with a fixed layout: version 1, 32-bit offsets and lengths,
 * no base offset and no extent index. Fixing the layout means the box size is
 * known before the offsets are, which is what makes the two-pass rebuild work.
 */
export const ILOC_OFFSET_SIZE = 4;

export interface IlocWriteResult {
  bytes: Uint8Array;
  /** Byte position of every extent offset field, relative to the box start. */
  offsetFields: { itemId: number; extentIndex: number; at: number }[];
}

export function writeItemLocation(items: readonly ItemLocation[]): IlocWriteResult {
  const payload = new ByteWriter(items.length * 24 + 16);
  const offsetFields: IlocWriteResult["offsetFields"] = [];

  payload.u8((ILOC_OFFSET_SIZE << 4) | ILOC_OFFSET_SIZE);
  payload.u8(0); // base_offset_size = 0, index_size = 0
  payload.u16(items.length);

  for (const item of items) {
    payload.u16(item.itemId);
    payload.u16(item.constructionMethod & 0x0f);
    payload.u16(item.dataReferenceIndex);
    payload.u16(item.extents.length);
    item.extents.forEach((extent, extentIndex) => {
      offsetFields.push({
        itemId: item.itemId,
        extentIndex,
        // 12 bytes of box header (size + type + version/flags) precede the payload.
        at: 12 + payload.length,
      });
      payload.u32(extent.offset);
      payload.u32(extent.length);
    });
  }

  return {
    bytes: writeFullBox("iloc", 1, 0, payload.finish()),
    offsetFields,
  };
}

export function parseItemInfo(bytes: Uint8Array, box: BmffBox): ItemInfoTable {
  const payload = boxPayload(bytes, box);
  const { version, flags } = readFullBoxHeader(payload, 0);
  const countSize = version === 0 ? 2 : 4;
  const childrenStart = box.payloadOffset + 4 + countSize;
  const children = parseBoxes(bytes, childrenStart, box.offset + box.size, 1);

  const entries: ItemInfoEntry[] = [];
  for (const child of children) {
    if (child.type !== "infe") continue;
    const entry = parseItemInfoEntry(bytes, child);
    if (entry) entries.push(entry);
  }

  return { version, flags, entries };
}

function parseItemInfoEntry(
  bytes: Uint8Array,
  box: BmffBox,
): ItemInfoEntry | null {
  const payload = boxPayload(bytes, box);
  if (payload.length < 4) return null;
  const { version } = readFullBoxHeader(payload, 0);
  const reader = new ByteReader(payload, 4);
  const raw = bytes.subarray(box.offset, box.offset + box.size);

  try {
    if (version < 2) {
      const itemId = reader.u16();
      const protectionIndex = reader.u16();
      const itemName = readCString(reader);
      const contentType = readCString(reader);
      return {
        itemId,
        protectionIndex,
        itemType: contentType ? "mime" : "",
        itemName,
        contentType: contentType || undefined,
        raw,
      };
    }

    const itemId = version === 2 ? reader.u16() : reader.u32();
    const protectionIndex = reader.u16();
    const itemType = reader.ascii(4);
    const itemName = readCString(reader);
    let contentType: string | undefined;
    if (itemType === "mime") {
      contentType = readCString(reader) || undefined;
    }
    return { itemId, protectionIndex, itemType, itemName, contentType, raw };
  } catch {
    return null;
  }
}

function readCString(reader: ByteReader): string {
  const start = reader.offset;
  let end = start;
  while (end < reader.length && reader.bytes[end] !== 0) end += 1;
  const value = trimNulls(decodeLatin1(reader.bytes.subarray(start, end)));
  reader.offset = Math.min(end + 1, reader.length);
  return value;
}

export function writeItemInfo(
  version: number,
  flags: number,
  entries: readonly ItemInfoEntry[],
): Uint8Array {
  const payload = new ByteWriter(entries.length * 32 + 8);
  if (version === 0) payload.u16(entries.length);
  else payload.u32(entries.length);
  for (const entry of entries) payload.raw(entry.raw);
  return writeFullBox("iinf", version, flags, payload.finish());
}

export function parseItemReferences(
  bytes: Uint8Array,
  box: BmffBox,
): ItemReferenceTable {
  const payload = boxPayload(bytes, box);
  const { version, flags } = readFullBoxHeader(payload, 0);
  const idSize = version === 0 ? 2 : 4;
  const references: ItemReference[] = [];

  for (const child of box.children ?? []) {
    const childPayload = boxPayload(bytes, child);
    const reader = new ByteReader(childPayload);
    try {
      const fromItemId = idSize === 2 ? reader.u16() : reader.u32();
      const count = reader.u16();
      const toItemIds: number[] = [];
      for (let index = 0; index < count; index += 1) {
        toItemIds.push(idSize === 2 ? reader.u16() : reader.u32());
      }
      references.push({ type: child.type, fromItemId, toItemIds });
    } catch {
      // A malformed reference box is simply not carried over.
    }
  }

  return { version, flags, references };
}

export function writeItemReferences(
  version: number,
  flags: number,
  references: readonly ItemReference[],
): Uint8Array | null {
  if (references.length === 0) return null;
  const idSize = version === 0 ? 2 : 4;
  const payload = new ByteWriter(references.length * 16);

  for (const reference of references) {
    const inner = new ByteWriter(8 + reference.toItemIds.length * idSize);
    if (idSize === 2) inner.u16(reference.fromItemId);
    else inner.u32(reference.fromItemId);
    inner.u16(reference.toItemIds.length);
    for (const target of reference.toItemIds) {
      if (idSize === 2) inner.u16(target);
      else inner.u32(target);
    }
    const innerBytes = inner.finish();
    payload.u32(innerBytes.length + 8);
    payload.ascii(reference.type);
    payload.raw(innerBytes);
  }

  return writeFullBox("iref", version, flags, payload.finish());
}

export function parsePropertyAssociations(
  bytes: Uint8Array,
  box: BmffBox,
): PropertyAssociationTable {
  const payload = boxPayload(bytes, box);
  const { version, flags } = readFullBoxHeader(payload, 0);
  const reader = new ByteReader(payload, 4);
  const entries: PropertyAssociation[] = [];

  try {
    const entryCount = reader.u32();
    for (let index = 0; index < entryCount; index += 1) {
      const itemId = version < 1 ? reader.u16() : reader.u32();
      const associationCount = reader.u8();
      const associations: PropertyAssociation["associations"] = [];
      for (let slot = 0; slot < associationCount; slot += 1) {
        if ((flags & 1) === 1) {
          const value = reader.u16();
          associations.push({
            essential: (value & 0x8000) !== 0,
            propertyIndex: value & 0x7fff,
          });
        } else {
          const value = reader.u8();
          associations.push({
            essential: (value & 0x80) !== 0,
            propertyIndex: value & 0x7f,
          });
        }
      }
      entries.push({ itemId, associations });
    }
  } catch {
    return { version, flags, entries };
  }

  return { version, flags, entries };
}

export function writePropertyAssociations(
  version: number,
  flags: number,
  entries: readonly PropertyAssociation[],
): Uint8Array {
  const payload = new ByteWriter(entries.length * 8 + 4);
  payload.u32(entries.length);
  for (const entry of entries) {
    if (version < 1) payload.u16(entry.itemId);
    else payload.u32(entry.itemId);
    payload.u8(entry.associations.length);
    for (const association of entry.associations) {
      if ((flags & 1) === 1) {
        payload.u16((association.essential ? 0x8000 : 0) | (association.propertyIndex & 0x7fff));
      } else {
        payload.u8((association.essential ? 0x80 : 0) | (association.propertyIndex & 0x7f));
      }
    }
  }
  return writeFullBox("ipma", version, flags, payload.finish());
}

export function readPrimaryItemId(
  bytes: Uint8Array,
  meta: BmffBox,
): number | undefined {
  const pitm = findBox(meta.children ?? [], "pitm");
  if (!pitm) return undefined;
  const payload = boxPayload(bytes, pitm);
  const { version } = readFullBoxHeader(payload, 0);
  const reader = new ByteReader(payload, 4);
  try {
    return version === 0 ? reader.u16() : reader.u32();
  } catch {
    return undefined;
  }
}

export function handlerType(bytes: Uint8Array, meta: BmffBox): string | undefined {
  const hdlr = findBox(meta.children ?? [], "hdlr");
  if (!hdlr) return undefined;
  const payload = boxPayload(bytes, hdlr);
  if (payload.length < 12) return undefined;
  return asciiOf(payload.subarray(8, 12));
}
