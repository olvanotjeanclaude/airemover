import type { ProcessingSettings, RebuildOptions } from "@/types/processing";
import type { RemovalOptions } from "@/types/metadata";
import { CATEGORY_DESCRIPTORS } from "./categories";
import { defaultConcurrency } from "./limits";

export const DEFAULT_REMOVAL: RemovalOptions = CATEGORY_DESCRIPTORS.reduce(
  (options, descriptor) => {
    options[descriptor.category] = descriptor.defaultOn;
    return options;
  },
  {} as RemovalOptions,
);

export const DEFAULT_REBUILD: RebuildOptions = {
  outputFormat: "original",
  jpegQuality: 92,
  webpQuality: 90,
  pngCompression: 6,
  resizeEnabled: false,
  maxDimension: 2560,
  stripAlpha: false,
  matteColor: "#ffffff",
};

export function createDefaultSettings(): ProcessingSettings {
  return {
    mode: "lossless",
    removal: { ...DEFAULT_REMOVAL },
    rebuild: { ...DEFAULT_REBUILD },
    filenameSuffix: "_clean",
    concurrency: defaultConcurrency(),
  };
}
