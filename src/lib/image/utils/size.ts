const UNITS = ["B", "KB", "MB", "GB"] as const;

/** Byte sizes in the UI use base-1024 with one decimal above the KB mark. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${UNITS[unit]}`;
}

export function formatPercent(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return "0%";
  return `${value.toFixed(digits)}%`;
}

export function formatMegapixels(width?: number, height?: number): string {
  if (!width || !height) return "—";
  const megapixels = (width * height) / 1_000_000;
  if (megapixels < 0.1) return `${megapixels.toFixed(2)} MP`;
  return `${megapixels.toFixed(1)} MP`;
}

export function megapixelsOf(width?: number, height?: number): number | undefined {
  if (!width || !height) return undefined;
  return (width * height) / 1_000_000;
}

/** Replaces the extension and appends the configured suffix. */
export function cleanedFileName(
  originalName: string,
  extension: string,
  suffix: string,
): string {
  const lastDot = originalName.lastIndexOf(".");
  const stem = lastDot > 0 ? originalName.slice(0, lastDot) : originalName;
  const safeStem = stem.replace(/[\\/:*?"<>|]+/g, "_").trim() || "image";
  return `${safeStem}${suffix}.${extension}`;
}
