import type { ImageFormat } from "@/types/image";
import { CleanError, type RebuildOptions } from "@/types/processing";
import { MAX_REBUILD_DIMENSION } from "@/constants/limits";
import { mimeTypeFor } from "../utils/format";
import { encodePng } from "./png-encode";

export interface RebuildOutput {
  bytes: Uint8Array;
  format: ImageFormat;
  mimeType: string;
  width: number;
  height: number;
  warnings: string[];
}

/**
 * Formats the browser can re-encode. AVIF, HEIC and TIFF decode fine but have
 * no reliable canvas encoder, so a rebuild of those lands as PNG.
 */
function resolveTargetFormat(
  requested: RebuildOptions["outputFormat"],
  source: ImageFormat,
): { format: ImageFormat; substituted: boolean } {
  if (requested !== "original") return { format: requested, substituted: false };
  if (source === "jpeg" || source === "png" || source === "webp") {
    return { format: source, substituted: false };
  }
  return { format: "png", substituted: true };
}

function targetDimensions(
  width: number,
  height: number,
  options: RebuildOptions,
): { width: number; height: number } {
  if (!options.resizeEnabled) return { width, height };
  const cap = Math.min(MAX_REBUILD_DIMENSION, Math.max(1, options.maxDimension));
  const longest = Math.max(width, height);
  if (longest <= cap) return { width, height };
  const scale = cap / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Redraws the decoded image onto a fresh canvas and re-encodes it. Nothing from
 * the original container survives, which is the point: it is the fallback for
 * files whose structure cannot be edited safely.
 */
export async function rebuildImage(
  bitmap: ImageBitmap,
  sourceFormat: ImageFormat,
  options: RebuildOptions,
): Promise<RebuildOutput> {
  const warnings: string[] = [];
  const target = resolveTargetFormat(options.outputFormat, sourceFormat);
  if (target.substituted) {
    warnings.push(
      `${sourceFormat.toUpperCase()} has no browser encoder, so the rebuilt file is PNG`,
    );
  }

  const size = targetDimensions(bitmap.width, bitmap.height, options);
  const flatten = options.stripAlpha || target.format === "jpeg";

  const canvas = new OffscreenCanvas(size.width, size.height);
  const context = canvas.getContext("2d", { alpha: !flatten, willReadFrequently: true });
  if (!context) {
    throw new CleanError("decode-failed", "The browser refused to provide a 2D canvas.");
  }

  if (flatten) {
    context.fillStyle = options.matteColor || "#ffffff";
    context.fillRect(0, 0, size.width, size.height);
  }
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, 0, 0, size.width, size.height);

  if (target.format === "png") {
    const imageData = context.getImageData(0, 0, size.width, size.height);
    const bytes = encodePng(imageData.data, size.width, size.height, {
      level: options.pngCompression,
      stripAlpha: flatten,
    });
    return {
      bytes,
      format: "png",
      mimeType: mimeTypeFor("png"),
      width: size.width,
      height: size.height,
      warnings,
    };
  }

  const mimeType = mimeTypeFor(target.format);
  const quality =
    target.format === "webp" ? options.webpQuality / 100 : options.jpegQuality / 100;

  let blob: Blob;
  try {
    blob = await canvas.convertToBlob({ type: mimeType, quality });
  } catch (error) {
    throw new CleanError(
      "encode-failed",
      `The browser could not encode ${target.format.toUpperCase()}: ${
        error instanceof Error ? error.message : "unknown error"
      }`,
    );
  }

  if (blob.type !== mimeType) {
    warnings.push(
      `The browser encoded ${blob.type || "an unknown type"} instead of ${mimeType}`,
    );
  }

  const bytes = new Uint8Array(await blob.arrayBuffer());
  return {
    bytes,
    format: target.format,
    mimeType: blob.type || mimeType,
    width: size.width,
    height: size.height,
    warnings,
  };
}
