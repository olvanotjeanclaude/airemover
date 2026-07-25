import { THUMBNAIL_MAX_EDGE, THUMBNAIL_SIZE_LIMIT } from "@/constants/limits";

/**
 * Decodes a preview with the platform decoder and re-encodes it small.
 *
 * The bitmap is resized during decode, so a 60-megapixel source never lands in
 * memory at full size. Formats the browser cannot decode (HEIC outside Safari)
 * return `null` and the card falls back to a format badge.
 */
export async function createThumbnail(
  file: File,
  maxEdge = THUMBNAIL_MAX_EDGE,
): Promise<string | null> {
  if (file.size > THUMBNAIL_SIZE_LIMIT) return null;
  if (typeof createImageBitmap !== "function") return null;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return null;
  }

  try {
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "medium";
    context.drawImage(bitmap, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/webp", 0.82);
    });
    if (!blob) return null;
    return URL.createObjectURL(blob);
  } catch {
    return null;
  } finally {
    bitmap.close();
  }
}

/** Decoded bitmap for rebuild mode, with EXIF orientation already applied. */
export async function decodeForRebuild(file: File): Promise<ImageBitmap | null> {
  if (typeof createImageBitmap !== "function") return null;
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return null;
  }
}
