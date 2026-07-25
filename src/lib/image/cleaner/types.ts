import type {
  RemovableCategory,
  SegmentCategory,
} from "@/types/metadata";

export interface RemovalTally {
  bytes: number;
  count: number;
}

export interface PreservedItem {
  label: string;
  bytes: number;
  reason: string;
}

/** What every container-specific cleaner returns. */
export interface ContainerCleanResult {
  bytes: Uint8Array;
  removed: Map<RemovableCategory, RemovalTally>;
  preserved: PreservedItem[];
  warnings: string[];
  /**
   * False when the cleaner had to touch compressed image data. The lossless
   * cleaners always report true; the rebuild path always reports false.
   */
  pixelStreamPreserved: boolean;
}

export function createTally(): Map<RemovableCategory, RemovalTally> {
  return new Map<RemovableCategory, RemovalTally>();
}

export function addRemoved(
  tally: Map<RemovableCategory, RemovalTally>,
  category: RemovableCategory,
  bytes: number,
  count = 1,
): void {
  const existing = tally.get(category) ?? { bytes: 0, count: 0 };
  existing.bytes += bytes;
  existing.count += count;
  tally.set(category, existing);
}

export function mergeTally(
  target: Map<RemovableCategory, RemovalTally>,
  source: Map<RemovableCategory, RemovalTally>,
): void {
  for (const [category, tally] of source) {
    addRemoved(target, category, tally.bytes, tally.count);
  }
}

/**
 * Maps a physical segment class onto the switch that controls it. `structural`
 * has no switch, so it returns `null` and can never be removed.
 */
export function switchForSegment(
  category: SegmentCategory,
): RemovableCategory | null {
  switch (category) {
    case "structural":
      return null;
    case "exif":
      return "exif";
    case "xmp":
      return "xmp";
    case "iptc":
      return "iptc";
    case "icc":
      return "icc";
    case "c2pa":
      return "c2pa";
    case "ai":
      return "ai";
    case "comment":
      return "comment";
    case "thumbnail":
    case "other":
      return "other";
    default:
      return "other";
  }
}
