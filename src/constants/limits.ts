/** Hard ceiling on queue length, matching the documented product promise. */
export const MAX_FILES = 500;

/**
 * A single image is held in memory three times at peak (source, parsed views,
 * output). 256 MB per file keeps the worst case inside a 2 GB tab budget while
 * still accepting full-frame medium-format TIFFs.
 */
export const MAX_FILE_BYTES = 256 * 1024 * 1024;

/** Below this a file cannot contain a valid container header. */
export const MIN_FILE_BYTES = 12;

/** Thumbnails are decoded at this longest edge to keep the grid cheap. */
export const THUMBNAIL_MAX_EDGE = 320;

/** Files larger than this skip thumbnail generation entirely. */
export const THUMBNAIL_SIZE_LIMIT = 64 * 1024 * 1024;

/** Upper bound for the rebuild-mode resize control. */
export const MAX_REBUILD_DIMENSION = 16384;

/** Worker pool size, clamped so a 500-file batch cannot exhaust the device. */
export const MIN_CONCURRENCY = 1;
export const MAX_CONCURRENCY = 8;

export function defaultConcurrency(): number {
  const cores =
    typeof navigator !== "undefined" && navigator.hardwareConcurrency
      ? navigator.hardwareConcurrency
      : 4;
  return Math.min(MAX_CONCURRENCY, Math.max(MIN_CONCURRENCY, cores - 1));
}
