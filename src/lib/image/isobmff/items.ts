import type { RemovableCategory } from "@/types/metadata";
import { looksLikeJumbf } from "../c2pa";
import { concatBytes } from "../utils/bytes";
import { boxPayload, type BmffBox } from "./boxes";
import type { ItemInfoEntry, ItemLocation } from "./meta";

/** Item types that hold picture data and must never be touched. */
const IMAGE_ITEM_TYPES = new Set([
  "av01",
  "avc1",
  "hvc1",
  "hev1",
  "jpeg",
  "j2k1",
  "grid",
  "iovl",
  "iden",
  "mask",
  "vvc1",
]);

const XMP_CONTENT_TYPES = ["rdf+xml", "xmp", "xml"];

export interface ClassifiedItem {
  entry: ItemInfoEntry;
  category: RemovableCategory | null;
  label: string;
}

/**
 * Decides what an item holds. Unknown item types are deliberately treated as
 * structural: keeping an unrecognised item costs a few bytes, while removing
 * one that turns out to be a tile or an alpha plane destroys the image.
 */
export function classifyItem(
  entry: ItemInfoEntry,
  data: Uint8Array | null,
): ClassifiedItem {
  const itemType = entry.itemType;

  if (itemType === "Exif") {
    return { entry, category: "exif", label: "EXIF item" };
  }

  if (itemType === "mime") {
    const contentType = (entry.contentType ?? "").toLowerCase();
    if (XMP_CONTENT_TYPES.some((type) => contentType.includes(type))) {
      return { entry, category: "xmp", label: "XMP item" };
    }
    if (data && looksLikeJumbf(data)) {
      return { entry, category: "c2pa", label: "C2PA manifest item" };
    }
    return { entry, category: "other", label: `MIME item (${entry.contentType ?? "unknown"})` };
  }

  if (itemType === "uuid" || itemType === "jumb" || itemType === "c2pa") {
    if (!data || looksLikeJumbf(data)) {
      return { entry, category: "c2pa", label: "C2PA manifest item" };
    }
    return { entry, category: "other", label: "UUID item" };
  }

  if (IMAGE_ITEM_TYPES.has(itemType)) {
    return { entry, category: null, label: `${itemType} image item` };
  }

  return { entry, category: null, label: `${itemType || "unnamed"} item` };
}

/**
 * Materialises an item's bytes by following its extents. Construction method 0
 * reads absolute file offsets, method 1 reads inside the `idat` box.
 */
export function readItemData(
  bytes: Uint8Array,
  location: ItemLocation | undefined,
  idat: BmffBox | undefined,
): Uint8Array | null {
  if (!location || location.extents.length === 0) return null;

  const parts: Uint8Array[] = [];
  for (const extent of location.extents) {
    let start: number;
    if (location.constructionMethod === 1) {
      if (!idat) return null;
      start = idat.payloadOffset + location.baseOffset + extent.offset;
      if (start + extent.length > idat.payloadOffset + idat.payloadSize) return null;
    } else if (location.constructionMethod === 0) {
      start = location.baseOffset + extent.offset;
    } else {
      return null;
    }
    if (start < 0 || start + extent.length > bytes.length) return null;
    parts.push(bytes.subarray(start, start + extent.length));
  }

  return parts.length === 1 ? parts[0] : concatBytes(parts);
}

/**
 * An `Exif` item begins with a 4-byte offset to the TIFF header, which is
 * almost always zero but is part of the format and must be honoured.
 */
export function exifPayloadOfItem(data: Uint8Array): Uint8Array | null {
  if (data.length < 8) return null;
  const skip =
    (data[0] << 24) | (data[1] << 16) | (data[2] << 8) | data[3];
  const start = 4 + skip;
  if (start + 8 > data.length) return null;
  return data.subarray(start);
}

export function itemLocationsById(
  locations: readonly ItemLocation[],
): Map<number, ItemLocation> {
  const map = new Map<number, ItemLocation>();
  for (const location of locations) map.set(location.itemId, location);
  return map;
}

export function idatBox(meta: BmffBox): BmffBox | undefined {
  return (meta.children ?? []).find((box) => box.type === "idat");
}

export function boxBytes(bytes: Uint8Array, box: BmffBox): Uint8Array {
  return bytes.subarray(box.offset, box.offset + box.size);
}

export function payloadOf(bytes: Uint8Array, box: BmffBox): Uint8Array {
  return boxPayload(bytes, box);
}
