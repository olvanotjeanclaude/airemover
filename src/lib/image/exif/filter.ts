import type { RemovableCategory, RemovalOptions } from "@/types/metadata";
import { C2PA_TIFF_TAG, looksLikeJumbf } from "../c2pa";
import { containsAiSignature } from "../parser/ai/signals";
import { decodeUserComment, decodeXpString } from "../utils/text";
import {
  COMMENT_TAGS,
  IDENTITY_TAGS,
  STRUCTURAL_TAGS,
  TAG,
  TIFF_TYPE,
} from "./constants";
import { entrySize, readAscii, type IfdKind, type TiffEntry, type TiffIfd, type TiffTree } from "./tiff";

/** Where the directory tree lives, which changes what counts as structural. */
export type TiffContext = "embedded" | "file";

export type EntryClass = RemovableCategory | "structural";

export interface TiffFilterOutcome {
  /** `null` when nothing worth keeping survived. */
  tree: TiffTree | null;
  removed: Map<RemovableCategory, { bytes: number; count: number }>;
  changed: boolean;
}

function entryText(entry: TiffEntry): string {
  if (entry.tag === TAG.UserComment) return decodeUserComment(entry.value);
  if (
    entry.tag === TAG.XPComment ||
    entry.tag === TAG.XPTitle ||
    entry.tag === TAG.XPSubject ||
    entry.tag === TAG.XPKeywords ||
    entry.tag === TAG.XPAuthor
  ) {
    return decodeXpString(entry.value);
  }
  return readAscii(entry);
}

export function classifyEntry(
  entry: TiffEntry,
  ifdKind: IfdKind,
  context: TiffContext,
): EntryClass {
  if (ifdKind === "gps" || entry.tag === TAG.GPSIFDPointer) return "gps";

  switch (entry.tag) {
    case TAG.XMP:
      return "xmp";
    case TAG.IPTCNAA:
    case TAG.PhotoshopSettings:
      return "iptc";
    case TAG.InterColorProfile:
      return "icc";
    case C2PA_TIFF_TAG:
      return "c2pa";
    case TAG.MakerNote:
    case TAG.PrintImageMatching:
    case TAG.Padding:
      return "exif";
    default:
      break;
  }

  if (
    (entry.type === TIFF_TYPE.UNDEFINED || entry.type === TIFF_TYPE.BYTE) &&
    entry.value.length >= 16 &&
    looksLikeJumbf(entry.value)
  ) {
    return "c2pa";
  }

  if (COMMENT_TAGS.has(entry.tag)) {
    return containsAiSignature(entryText(entry)) ? "ai" : "comment";
  }

  if (context === "file" && STRUCTURAL_TAGS.has(entry.tag)) return "structural";
  if (context === "file" && (entry.tag === TAG.FreeOffsets || entry.tag === TAG.FreeByteCounts)) {
    return "other";
  }

  if (IDENTITY_TAGS.has(entry.tag)) return "exif";
  if (ifdKind === "exif" || ifdKind === "interop") return "exif";
  if (entry.tag === TAG.ExifIFDPointer) return "exif";
  if (entry.tag === TAG.SubIFDs) return "structural";

  // Everything a well-known table does not cover is vendor or private data.
  if (context === "embedded" && STRUCTURAL_TAGS.has(entry.tag)) return "exif";
  return "other";
}

/**
 * Rebuilds a directory tree with the selected categories dropped.
 *
 * The Exif and Interop pointers are recursed into rather than dropped outright,
 * so "keep EXIF but remove the comment" and "keep EXIF but remove GPS" both do
 * exactly what they say.
 */
export function filterTiffTree(
  tree: TiffTree,
  options: RemovalOptions,
  context: TiffContext,
): TiffFilterOutcome {
  const removed = new Map<RemovableCategory, { bytes: number; count: number }>();
  let changed = false;

  const record = (category: RemovableCategory, bytes: number): void => {
    const existing = removed.get(category) ?? { bytes: 0, count: 0 };
    existing.bytes += bytes;
    existing.count += 1;
    removed.set(category, existing);
    changed = true;
  };

  const filterIfd = (ifd: TiffIfd): TiffIfd => {
    const entries: TiffEntry[] = [];
    let ifdChanged = false;

    for (const entry of ifd.entries) {
      const category = classifyEntry(entry, ifd.kind, context);

      if (category !== "structural" && options[category]) {
        record(category, entrySize(entry));
        ifdChanged = true;
        continue;
      }

      // A kept pointer still needs its children filtered, otherwise metadata
      // simply hides one level down (SubIFDs in a DNG, Interop under Exif).
      const children = entry.subIfds;
      if (children && children.length > 0) {
        const filtered = children.map(filterIfd).filter((child) => child.entries.length > 0);
        if (filtered.length === 0) {
          record(category === "structural" ? "other" : category, entrySize(entry));
          ifdChanged = true;
          continue;
        }
        const unchanged =
          filtered.length === children.length &&
          filtered.every((child, index) => child === children[index]);
        if (unchanged) {
          entries.push(entry);
        } else {
          entries.push({ ...entry, subIfds: filtered, count: filtered.length });
          ifdChanged = true;
        }
        continue;
      }

      entries.push(entry);
    }

    return ifdChanged ? { ...ifd, entries } : ifd;
  };

  const ifds = tree.ifds.map(filterIfd);
  const surviving = ifds.filter((ifd, index) => {
    if (ifd.entries.length > 0) return true;
    // An empty directory is only worth dropping if it is not IFD0 of a real file.
    if (context === "file" && index === 0) return true;
    return false;
  });

  if (surviving.length === 0 || surviving.every((ifd) => ifd.entries.length === 0)) {
    return { tree: null, removed, changed: true };
  }

  const sameShape =
    !changed &&
    surviving.length === tree.ifds.length &&
    surviving.every((ifd, index) => ifd === tree.ifds[index]);

  return {
    tree: sameShape ? tree : { ...tree, ifds: surviving },
    removed,
    changed,
  };
}

/** Sums the categories a tree currently contains, for the inspector. */
export function measureTiffCategories(
  tree: TiffTree,
  context: TiffContext,
): Map<RemovableCategory, number> {
  const totals = new Map<RemovableCategory, number>();
  const walk = (ifd: TiffIfd): void => {
    for (const entry of ifd.entries) {
      const category = classifyEntry(entry, ifd.kind, context);
      if (category !== "structural") {
        totals.set(category, (totals.get(category) ?? 0) + entrySize(entry));
      }
      for (const child of entry.subIfds ?? []) walk(child);
    }
  };
  for (const ifd of tree.ifds) walk(ifd);
  return totals;
}
