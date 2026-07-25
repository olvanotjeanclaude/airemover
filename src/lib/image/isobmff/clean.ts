import type { RemovalOptions } from "@/types/metadata";
import { isC2paUuid } from "../c2pa";
import {
  addRemoved,
  createTally,
  type ContainerCleanResult,
  type PreservedItem,
} from "../cleaner/types";
import { ByteWriter, concatBytes } from "../utils/bytes";
import { findBox, parseBoxes, writeFullBox, type BmffBox } from "./boxes";
import {
  classifyItem,
  idatBox,
  itemLocationsById,
  readItemData,
} from "./items";
import {
  normalizeItemLocations,
  parseItemInfo,
  parseItemLocation,
  parseItemReferences,
  parsePropertyAssociations,
  writeItemInfo,
  writeItemLocation,
  writeItemReferences,
  writePropertyAssociations,
  type ItemLocation,
} from "./meta";

export class BmffUnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BmffUnsupportedError";
  }
}

/** Reasons a specific file cannot take the byte-level path. */
export function checkLosslessSupport(bytes: Uint8Array): string | undefined {
  const boxes = parseBoxes(bytes);
  if (boxes.length === 0) return "The file contains no readable ISOBMFF boxes";
  if (findBox(boxes, "moov")) {
    return "Image sequences carry a movie box whose sample tables cannot be relocated safely";
  }
  const meta = findBox(boxes, "meta");
  if (!meta) return undefined;
  const ilocBox = findBox(meta.children ?? [], "iloc");
  if (!ilocBox) return undefined;
  try {
    const iloc = parseItemLocation(bytes, ilocBox);
    if (iloc.items.some((item) => item.constructionMethod === 2)) {
      return "Items stored inside other items (construction method 2) cannot be relocated";
    }
    if (iloc.items.some((item) => item.dataReferenceIndex !== 0)) {
      return "Items stored in an external file cannot be rewritten";
    }
    if (iloc.items.some((item) => item.extents.some((extent) => extent.length > 0xffffffff))) {
      return "An item extent is larger than the 32-bit item location table allows";
    }
  } catch (error) {
    return `The item location table could not be read (${error instanceof Error ? error.message : "unknown error"})`;
  }
  return undefined;
}

/**
 * Rebuilds an AVIF / HEIC file without the selected metadata items.
 *
 * The hard part is that `iloc` stores absolute file offsets, so removing any
 * box shifts every extent. The file is therefore laid out in two passes: the
 * item location table is written with a fixed 32-bit layout so its size is
 * known up front, and the extent offsets are back-patched once the compacted
 * `mdat` has been emitted.
 */
export function cleanIsobmff(
  bytes: Uint8Array,
  options: RemovalOptions,
): ContainerCleanResult {
  const blocked = checkLosslessSupport(bytes);
  if (blocked) throw new BmffUnsupportedError(blocked);

  const removed = createTally();
  const preserved: PreservedItem[] = [];
  const warnings: string[] = [];

  const topLevel = parseBoxes(bytes);
  const meta = findBox(topLevel, "meta");

  const removedUuidBoxes = new Set<BmffBox>();
  if (options.c2pa) {
    for (const box of topLevel) {
      if (box.type === "uuid" && box.uuid && isC2paUuid(box.uuid)) {
        removedUuidBoxes.add(box);
        addRemoved(removed, "c2pa", box.size);
      }
    }
  }

  if (!meta) {
    if (removedUuidBoxes.size === 0) {
      return {
        bytes,
        removed,
        preserved,
        warnings,
        pixelStreamPreserved: true,
      };
    }
    const output = new ByteWriter(bytes.length);
    for (const box of topLevel) {
      if (removedUuidBoxes.has(box)) continue;
      output.raw(bytes.subarray(box.offset, box.offset + box.size));
    }
    return {
      bytes: output.finish(),
      removed,
      preserved,
      warnings,
      pixelStreamPreserved: true,
    };
  }

  const metaChildren = meta.children ?? [];
  const ilocBox = findBox(metaChildren, "iloc");
  const iinfBox = findBox(metaChildren, "iinf");
  const idat = idatBox(meta);

  const locations = ilocBox
    ? normalizeItemLocations(parseItemLocation(bytes, ilocBox).items)
    : [];
  const iinf = iinfBox ? parseItemInfo(bytes, iinfBox) : null;
  const locationsById = itemLocationsById(locations);

  const removedItemIds = new Set<number>();
  if (iinf) {
    for (const entry of iinf.entries) {
      const data = readItemData(bytes, locationsById.get(entry.itemId), idat);
      const classified = classifyItem(entry, data);
      const category = classified.category;
      if (!category || !options[category]) continue;
      removedItemIds.add(entry.itemId);
      const size = itemBytes(locationsById.get(entry.itemId)) + entry.raw.length;
      addRemoved(removed, category, size);
    }
  }

  if (removedItemIds.size === 0 && removedUuidBoxes.size === 0) {
    return { bytes, removed, preserved, warnings, pixelStreamPreserved: true };
  }

  // --- Rebuild the meta box -------------------------------------------------
  const keptLocations = locations.filter(
    (item) => !removedItemIds.has(item.itemId),
  );
  const ilocWrite = writeItemLocation(keptLocations);

  const metaPayload = new ByteWriter(meta.payloadSize);
  let ilocOffsetInMetaPayload = -1;

  for (const child of metaChildren) {
    switch (child.type) {
      case "iloc": {
        ilocOffsetInMetaPayload = metaPayload.length;
        metaPayload.raw(ilocWrite.bytes);
        break;
      }
      case "iinf": {
        if (!iinf) {
          metaPayload.raw(bytes.subarray(child.offset, child.offset + child.size));
          break;
        }
        const keptEntries = iinf.entries.filter(
          (entry) => !removedItemIds.has(entry.itemId),
        );
        metaPayload.raw(writeItemInfo(iinf.version, iinf.flags, keptEntries));
        break;
      }
      case "iref": {
        const table = parseItemReferences(bytes, child);
        const keptReferences = table.references
          .filter((reference) => !removedItemIds.has(reference.fromItemId))
          .map((reference) => ({
            ...reference,
            toItemIds: reference.toItemIds.filter((id) => !removedItemIds.has(id)),
          }))
          .filter((reference) => reference.toItemIds.length > 0);
        const rewritten = writeItemReferences(table.version, table.flags, keptReferences);
        if (rewritten) metaPayload.raw(rewritten);
        break;
      }
      case "iprp": {
        metaPayload.raw(rebuildItemProperties(bytes, child, removedItemIds));
        break;
      }
      default:
        metaPayload.raw(bytes.subarray(child.offset, child.offset + child.size));
        break;
    }
  }

  const metaBox = writeFullBox("meta", meta.version ?? 0, meta.flags ?? 0, metaPayload.finish());

  // --- Lay out the file -----------------------------------------------------
  const output = new ByteWriter(bytes.length);
  let metaStartInOutput = -1;

  for (const box of topLevel) {
    if (removedUuidBoxes.has(box)) continue;
    if (box.type === "mdat" || box.type === "free" || box.type === "skip") continue;
    if (box === meta) {
      metaStartInOutput = output.length;
      output.raw(metaBox);
      continue;
    }
    output.raw(bytes.subarray(box.offset, box.offset + box.size));
  }

  const fileExtents = keptLocations.filter((item) => item.constructionMethod === 0);
  const newOffsets = new Map<string, number>();

  if (fileExtents.length > 0) {
    const mdatStart = output.length;
    output.u32(0);
    output.ascii("mdat");
    for (const item of fileExtents) {
      item.extents.forEach((extent, extentIndex) => {
        const start = item.baseOffset + extent.offset;
        if (start < 0 || start + extent.length > bytes.length) {
          warnings.push(`Item ${item.itemId} points outside the file and was skipped`);
          return;
        }
        newOffsets.set(`${item.itemId}:${extentIndex}`, output.length);
        output.raw(bytes.subarray(start, start + extent.length));
      });
    }
    output.patchU32(mdatStart, output.length - mdatStart);
  }

  if (metaStartInOutput < 0 || ilocOffsetInMetaPayload < 0) {
    throw new BmffUnsupportedError("The rebuilt file lost its item location table");
  }

  // meta box header is 12 bytes (size + type + version/flags).
  const ilocBase = metaStartInOutput + 12 + ilocOffsetInMetaPayload;
  for (const field of ilocWrite.offsetFields) {
    const location = keptLocations.find((item) => item.itemId === field.itemId);
    if (!location || location.constructionMethod !== 0) continue;
    const relocated = newOffsets.get(`${field.itemId}:${field.extentIndex}`);
    if (relocated === undefined) continue;
    output.patchU32(ilocBase + field.at, relocated);
  }

  return {
    bytes: output.finish(),
    removed,
    preserved,
    warnings,
    pixelStreamPreserved: true,
  };
}

function itemBytes(location: ItemLocation | undefined): number {
  if (!location) return 0;
  return location.extents.reduce((total, extent) => total + extent.length, 0);
}

/** Rebuilds `iprp`, filtering `ipma` entries for items that no longer exist. */
function rebuildItemProperties(
  bytes: Uint8Array,
  iprp: BmffBox,
  removedItemIds: ReadonlySet<number>,
): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const child of iprp.children ?? []) {
    if (child.type !== "ipma") {
      parts.push(bytes.subarray(child.offset, child.offset + child.size));
      continue;
    }
    const table = parsePropertyAssociations(bytes, child);
    const kept = table.entries.filter((entry) => !removedItemIds.has(entry.itemId));
    if (kept.length === table.entries.length) {
      parts.push(bytes.subarray(child.offset, child.offset + child.size));
      continue;
    }
    parts.push(writePropertyAssociations(table.version, table.flags, kept));
  }
  const payload = concatBytes(parts);
  const writer = new ByteWriter(payload.length + 8);
  writer.u32(payload.length + 8);
  writer.ascii("iprp");
  writer.raw(payload);
  return writer.finish();
}
