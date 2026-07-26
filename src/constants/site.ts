export const SITE = {
  name: "Image Metadata Cleaner",
  shortName: "Metadata Cleaner",
  tagline: "Remove Image Metadata Instantly",
  description:
    "Remove EXIF, GPS, XMP, AI metadata and C2PA from your images entirely inside your browser. No uploads, no tracking, 100% private.",
  url: "https://airemover.varotranaka.com",
  locale: "en_US",
  themeColor: {
    light: "#ffffff",
    dark: "#0d1117",
  },
} as const;

export const SUPPORTED_FORMATS = [
  {
    label: "JPEG",
    extensions: [".jpg", ".jpeg", ".jpe", ".jfif"],
    mime: ["image/jpeg"],
    lossless: true,
    note: "Baseline, progressive and 12-bit. APP0-APP15, COM and JUMBF segments are parsed individually.",
  },
  {
    label: "PNG",
    extensions: [".png", ".apng"],
    mime: ["image/png", "image/apng"],
    lossless: true,
    note: "Full chunk walk with CRC validation. APNG animation chunks are preserved.",
  },
  {
    label: "WebP",
    extensions: [".webp"],
    mime: ["image/webp"],
    lossless: true,
    note: "RIFF container rebuild. VP8, VP8L, alpha and animation chunks are preserved bit-for-bit.",
  },
  {
    label: "AVIF",
    extensions: [".avif", ".avifs"],
    mime: ["image/avif"],
    lossless: true,
    note: "ISOBMFF box rewrite with item location tables repaired after metadata items are dropped.",
  },
  {
    label: "HEIC / HEIF",
    extensions: [".heic", ".heif"],
    mime: ["image/heic", "image/heif"],
    lossless: true,
    note: "Same ISOBMFF pipeline as AVIF. Previews need a browser with a HEIF decoder.",
  },
  {
    label: "TIFF",
    extensions: [".tif", ".tiff"],
    mime: ["image/tiff"],
    lossless: true,
    note: "IFD tree rebuilt from scratch; strip and tile data is relocated with corrected offsets.",
  },
] as const;

export const AI_GENERATORS = [
  "Automatic1111",
  "Stable Diffusion",
  "ComfyUI",
  "Fooocus",
  "InvokeAI",
  "NovelAI",
  "Flux",
  "Midjourney",
  "Adobe Firefly",
  "OpenAI Images",
  "Google Imagen",
] as const;
