import type { MetadataSegment, RemovalOptions } from "@/types/metadata";
import { C2PA_TIFF_TAG, looksLikeJumbf } from "../c2pa";
import {
  addRemoved,
  createTally,
  mergeTally,
  type ContainerCleanResult,
  type PreservedItem,
} from "../cleaner/types";
import {
  TAG,
  classifyEntry,
  collectExifAiSources,
  entrySize,
  filterTiffTree,
  parseTiff,
  readAscii,
  tagName,
  writeTiff,
  type TiffEntry,
  type TiffIfd,
  type TiffTree,
} from "../exif";
import { createBundle, type ParsedContainer } from "../parser/types";
import { extractXmpPacket } from "../xmp";

const PHOTOMETRIC_LABELS: Readonly<Record<number, string>> = {
  0: "Grayscale (white is zero)",
  1: "Grayscale (black is zero)",
  2: "RGB",
  3: "Palette",
  4: "Transparency mask",
  5: "CMYK",
  6: "YCbCr",
  8: "CIELAB",
  9: "ICCLab",
  10: "ITULab",
  32803: "Colour filter array",
  34892: "Linear raw",
};

const COMPRESSION_LABELS: Readonly<Record<number, string>> = {
  1: "Uncompressed",
  2: "CCITT Group 3 (1D)",
  3: "CCITT Group 3",
  4: "CCITT Group 4",
  5: "LZW",
  6: "JPEG (old style)",
  7: "JPEG",
  8: "Deflate (Adobe)",
  32773: "PackBits",
  32946: "Deflate",
  34712: "JPEG 2000",
  34925: "LZMA",
  50000: "Zstd",
  50001: "WebP",
};

function numberOf(ifd: TiffIfd, tag: number, littleEndian: boolean): number | undefined {
  const entry = ifd.entries.find((candidate) => candidate.tag === tag);
  if (!entry) return undefined;
  const view = new DataView(entry.value.buffer, entry.value.byteOffset, entry.value.byteLength);
  if (entry.value.length >= 4 && (entry.type === 4 || entry.type === 9)) {
    return view.getUint32(0, littleEndian);
  }
  if (entry.value.length >= 2) return view.getUint16(0, littleEndian);
  if (entry.value.length >= 1) return view.getUint8(0);
  return undefined;
}

export function inspectTiff(bytes: Uint8Array): ParsedContainer {
  const tree = parseTiff(bytes);
  const bundle = createBundle();
  const segments: MetadataSegment[] = [];
  const warnings = [...tree.warnings];
  const ifd0 = tree.ifds[0];

  bundle.exifPayloads.push(bytes);
  bundle.aiSources.push(...collectExifAiSources(tree, "TIFF"));

  const walk = (ifd: TiffIfd, path: string): void => {
    for (const entry of ifd.entries) {
      const category = classifyEntry(entry, ifd.kind, "file");
      if (category !== "structural") {
        segments.push({
          id: `${path}:${entry.tag}`,
          category: category === "gps" ? "exif" : category,
          container: path,
          label: tagName(entry.tag, ifd.kind === "gps"),
          detail: describeEntry(entry),
          offset: entry.valueOffset,
          size: entrySize(entry),
        });
        collectPayload(entry, bundle);
      }
      for (const child of entry.subIfds ?? []) {
        walk(child, `${path}/${child.kind}`);
      }
    }
  };

  tree.ifds.forEach((ifd, index) => walk(ifd, index === 0 ? "IFD0" : `IFD${index}`));

  const photometric = numberOf(ifd0, TAG.PhotometricInterpretation, tree.littleEndian);
  const compression = numberOf(ifd0, TAG.Compression, tree.littleEndian);
  const samples = numberOf(ifd0, TAG.SamplesPerPixel, tree.littleEndian);
  const bitDepth = numberOf(ifd0, TAG.BitsPerSample, tree.littleEndian);

  if (tree.ifds.length > 1) {
    warnings.push(
      `This TIFF holds ${tree.ifds.length} directories; every page is preserved with its pixel data`,
    );
  }

  return {
    format: "tiff",
    container: {
      format: "tiff",
      width: numberOf(ifd0, TAG.ImageWidth, tree.littleEndian),
      height: numberOf(ifd0, TAG.ImageLength, tree.littleEndian),
      colorSpace:
        photometric === undefined ? undefined : (PHOTOMETRIC_LABELS[photometric] ?? `Photometric ${photometric}`),
      bitDepth,
      channels: samples,
      hasAlpha: (samples ?? 0) > 3 || photometric === 4,
      isAnimated: false,
      isProgressive: false,
      encoding:
        compression === undefined
          ? undefined
          : (COMPRESSION_LABELS[compression] ?? `Compression ${compression}`),
    },
    segments,
    bundle,
    warnings,
    losslessSupported: true,
  };
}

function describeEntry(entry: TiffEntry): string | undefined {
  if (entry.type === 2) {
    const text = readAscii(entry);
    return text ? text.slice(0, 80) : undefined;
  }
  if (entry.subIfds && entry.subIfds.length > 0) {
    const total = entry.subIfds.reduce((count, ifd) => count + ifd.entries.length, 0);
    return `${total} nested tag(s)`;
  }
  return `${entry.value.length} byte(s)`;
}

function collectPayload(entry: TiffEntry, bundle: ReturnType<typeof createBundle>): void {
  if (entry.tag === TAG.XMP) {
    const packet = extractXmpPacket(entry.value);
    if (packet) {
      bundle.xmpPackets.push(packet.text);
      bundle.xmpBytes += entry.value.length;
    }
    return;
  }
  if (entry.tag === TAG.IPTCNAA) {
    bundle.iptcPayloads.push(entry.value);
    return;
  }
  if (entry.tag === TAG.InterColorProfile) {
    bundle.iccPayloads.push(entry.value);
    return;
  }
  if (entry.tag === C2PA_TIFF_TAG || looksLikeJumbf(entry.value)) {
    bundle.c2paPayloads.push(entry.value);
    bundle.c2paLocation = "TIFF private tag (JUMBF)";
  }
}

/**
 * Rebuilds a TIFF from its directory tree. Because the writer relocates every
 * strip and tile and rewrites the offsets that point at them, the compressed
 * pixel data is copied byte for byte while the descriptive tags disappear.
 */
export function cleanTiff(
  bytes: Uint8Array,
  options: RemovalOptions,
): ContainerCleanResult {
  const tree = parseTiff(bytes);
  const warnings = [...tree.warnings];
  const preserved: PreservedItem[] = [];
  const removed = createTally();

  const unsupported = findUnsupportedTags(tree);
  if (unsupported) {
    throw new Error(unsupported);
  }

  const outcome = filterTiffTree(tree, options, "file");
  mergeTally(removed, outcome.removed);

  if (!outcome.changed || !outcome.tree) {
    return {
      bytes,
      removed,
      preserved,
      warnings,
      pixelStreamPreserved: true,
    };
  }

  const rebuilt = writeTiff(outcome.tree);

  // Rebuilding also drops padding and gaps the original file carried.
  if (rebuilt.length < bytes.length) {
    const structural = bytes.length - rebuilt.length;
    let accounted = 0;
    for (const tally of removed.values()) accounted += tally.bytes;
    if (structural > accounted) {
      addRemoved(removed, "other", structural - accounted, 0);
    }
  }

  return {
    bytes: rebuilt,
    removed,
    preserved,
    warnings,
    pixelStreamPreserved: true,
  };
}

/**
 * Old-style JPEG-in-TIFF stores its tables at absolute offsets that the writer
 * has no way to repair, so those files are refused rather than corrupted.
 */
function findUnsupportedTags(tree: TiffTree): string | undefined {
  const blocked = [TAG.JPEGQTables, TAG.JPEGDCTables, TAG.JPEGACTables];
  for (const ifd of tree.ifds) {
    for (const entry of ifd.entries) {
      if (blocked.includes(entry.tag as (typeof blocked)[number])) {
        return "This TIFF uses the deprecated JPEG-in-TIFF layout, whose table offsets cannot be relocated";
      }
    }
  }
  return undefined;
}
