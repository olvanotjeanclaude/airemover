import type { ImageFormat } from "@/types/image";
import type { RemovableCategory } from "@/types/metadata";
import {
  CleanError,
  type CleanResult,
  type ProcessingSettings,
  type RemovedCategoryStat,
} from "@/types/processing";
import { CATEGORY_LABELS } from "@/constants/categories";
import { buildReport } from "../inspector";
import { BmffUnsupportedError, cleanIsobmff } from "../isobmff";
import { cleanJpeg, parseJpeg } from "../jpeg";
import { cleanPngBytes } from "../png";
import { parseContainer } from "../parser";
import { cleanTiff } from "../tiff";
import { detectFormat, mimeTypeFor } from "../utils/format";
import { cleanWebpBytes } from "../webp";
import { rebuildImage } from "./rebuild";
import type { ContainerCleanResult } from "./types";

export * from "./types";
export { encodePng } from "./png-encode";
export { rebuildImage, type RebuildOutput } from "./rebuild";

/** Byte-level clean: the compressed image stream is copied, never re-encoded. */
export function cleanLossless(
  bytes: Uint8Array,
  settings: ProcessingSettings,
): ContainerCleanResult {
  const format = detectFormat(bytes);

  switch (format) {
    case "jpeg":
      return cleanJpeg(bytes, parseJpeg(bytes), settings.removal);
    case "png":
      return cleanPngBytes(bytes, settings.removal);
    case "webp":
      return cleanWebpBytes(bytes, settings.removal);
    case "avif":
    case "heic":
      return cleanIsobmff(bytes, settings.removal);
    case "tiff":
      return cleanTiff(bytes, settings.removal);
    default:
      throw new CleanError(
        "unsupported-format",
        "This container has no byte-level cleaner. Try rebuild mode.",
      );
  }
}

function toStats(
  removed: Map<RemovableCategory, { bytes: number; count: number }>,
): RemovedCategoryStat[] {
  return [...removed.entries()]
    .filter(([, tally]) => tally.bytes > 0 || tally.count > 0)
    .map(([category, tally]) => ({
      category,
      bytes: tally.bytes,
      count: tally.count,
    }))
    .sort((a, b) => b.bytes - a.bytes);
}

/**
 * Re-inspects the output. Reporting what a clean *claims* to have removed is
 * not the same as proving it: the verification report is generated from the
 * bytes the user is about to download.
 */
function verify(
  bytes: Uint8Array,
  format: ImageFormat,
  warnings: string[],
): ReturnType<typeof buildReport> {
  try {
    return buildReport(parseContainer(bytes), bytes.length);
  } catch (error) {
    warnings.push(
      `The cleaned file could not be re-inspected (${error instanceof Error ? error.message : "unknown error"})`,
    );
    return {
      format,
      container: { format },
      fileSize: bytes.length,
      segments: [],
      metadataBytes: 0,
      ai: [],
      warnings: [],
      losslessSupported: false,
    };
  }
}

function finish(
  original: Uint8Array,
  result: ContainerCleanResult,
  format: ImageFormat,
  mimeType: string,
  mode: ProcessingSettings["mode"],
): CleanResult {
  const warnings = [...result.warnings];
  const verification = verify(result.bytes, format, warnings);
  const bytesRemoved = Math.max(0, original.length - result.bytes.length);

  const remaining = [
    ...result.preserved.map((item) => ({
      label: item.label,
      bytes: item.bytes,
      reason: item.reason,
    })),
    ...verification.segments
      .filter((segment) => segment.category !== "structural")
      .map((segment) => ({
        label: segment.label,
        bytes: segment.size,
        reason: segment.preservedReason ?? "Kept because its switch is off",
      })),
  ];

  // Two sources can describe the same surviving block; keep the richer reason.
  const deduped = new Map<string, (typeof remaining)[number]>();
  for (const item of remaining) {
    const existing = deduped.get(item.label);
    if (!existing || existing.bytes < item.bytes) deduped.set(item.label, item);
  }

  return {
    bytes: result.bytes,
    outputFormat: format,
    outputMimeType: mimeType,
    mode,
    originalSize: original.length,
    cleanedSize: result.bytes.length,
    bytesRemoved,
    percentReduction:
      original.length > 0 ? (bytesRemoved / original.length) * 100 : 0,
    removed: toStats(result.removed),
    remaining: [...deduped.values()],
    pixelStreamPreserved: result.pixelStreamPreserved,
    warnings,
    verification,
  };
}

export function cleanImageLossless(
  bytes: Uint8Array,
  settings: ProcessingSettings,
): CleanResult {
  const format = detectFormat(bytes);
  try {
    const result = cleanLossless(bytes, settings);
    return finish(bytes, result, format, mimeTypeFor(format), "lossless");
  } catch (error) {
    if (error instanceof BmffUnsupportedError) {
      throw new CleanError("corrupt-container", `${error.message}. Try rebuild mode.`);
    }
    if (error instanceof CleanError) throw error;
    throw new CleanError(
      "corrupt-container",
      error instanceof Error
        ? `The file could not be rebuilt: ${error.message}`
        : "The file could not be rebuilt.",
    );
  }
}

/**
 * Rebuild path. The re-encoded output is run through the lossless cleaner as
 * well, so anything the platform encoder decides to embed is stripped too.
 */
export async function cleanImageRebuild(
  bytes: Uint8Array,
  bitmap: ImageBitmap,
  settings: ProcessingSettings,
): Promise<CleanResult> {
  const sourceFormat = detectFormat(bytes);
  const rebuilt = await rebuildImage(bitmap, sourceFormat, settings.rebuild);

  let finalBytes = rebuilt.bytes;
  const warnings = [...rebuilt.warnings];
  const removed = new Map<RemovableCategory, { bytes: number; count: number }>();

  try {
    const sweep = cleanLossless(rebuilt.bytes, settings);
    finalBytes = sweep.bytes;
    for (const [category, tally] of sweep.removed) removed.set(category, tally);
    warnings.push(...sweep.warnings);
  } catch {
    // A freshly encoded file that cannot be re-parsed is still valid output.
  }

  const result: ContainerCleanResult = {
    bytes: finalBytes,
    removed,
    preserved: [],
    warnings,
    pixelStreamPreserved: false,
  };

  return finish(bytes, result, rebuilt.format, rebuilt.mimeType, "rebuild");
}

export function describeRemoval(stat: RemovedCategoryStat): string {
  return CATEGORY_LABELS[stat.category] ?? stat.category;
}
