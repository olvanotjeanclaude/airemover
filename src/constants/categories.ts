import type { RemovableCategory } from "@/types/metadata";

export interface CategoryDescriptor {
  category: RemovableCategory;
  label: string;
  description: string;
  /** Shown when the switch is off, explaining what stays in the file. */
  keepWarning: string;
  /** Default state. ICC is the one thing kept, because dropping it shifts colour. */
  defaultOn: boolean;
}

export const CATEGORY_DESCRIPTORS: readonly CategoryDescriptor[] = [
  {
    category: "exif",
    label: "EXIF",
    description:
      "Camera make and model, lens, serial numbers, exposure settings, capture timestamps and maker notes.",
    keepWarning: "Camera identity and capture times stay embedded.",
    defaultOn: true,
  },
  {
    category: "gps",
    label: "GPS location",
    description:
      "Latitude, longitude, altitude and GPS timestamps. Removed from inside EXIF even when EXIF itself is kept.",
    keepWarning: "The exact capture location stays embedded.",
    defaultOn: true,
  },
  {
    category: "xmp",
    label: "XMP",
    description:
      "Adobe XMP packets: editing history, document IDs, creator, rights and sidecar provenance links.",
    keepWarning: "Editing history and document IDs stay embedded.",
    defaultOn: true,
  },
  {
    category: "iptc",
    label: "IPTC / Photoshop",
    description:
      "IPTC IIM records and Photoshop image resources: byline, credit, captions, keywords and locations.",
    keepWarning: "Byline, credit and caption fields stay embedded.",
    defaultOn: true,
  },
  {
    category: "c2pa",
    label: "C2PA / Content Credentials",
    description:
      "JUMBF manifest stores written by Content Credentials tooling, including the signed provenance chain.",
    keepWarning: "The signed provenance manifest stays embedded.",
    defaultOn: true,
  },
  {
    category: "ai",
    label: "AI generation data",
    description:
      "Prompts, negative prompts, seeds, samplers, checkpoints, LoRAs and workflow graphs written by image generators.",
    keepWarning: "Prompts and model settings stay embedded.",
    defaultOn: true,
  },
  {
    category: "comment",
    label: "Comments & text",
    description:
      "Free-text blocks: JPEG COM markers, PNG tEXt/iTXt/zTXt chunks and software watermarks.",
    keepWarning: "Free-text comments stay embedded.",
    defaultOn: true,
  },
  {
    category: "other",
    label: "Unknown metadata",
    description:
      "Vendor and unrecognised metadata blocks that are not needed to decode the image.",
    keepWarning: "Unrecognised vendor blocks stay embedded.",
    defaultOn: true,
  },
  {
    category: "icc",
    label: "ICC colour profile",
    description:
      "The embedded colour profile. Removing it makes wide-gamut images look washed out or oversaturated.",
    keepWarning: "",
    defaultOn: false,
  },
] as const;

export const CATEGORY_LABELS: Record<RemovableCategory, string> =
  CATEGORY_DESCRIPTORS.reduce(
    (map, descriptor) => {
      map[descriptor.category] = descriptor.label;
      return map;
    },
    {} as Record<RemovableCategory, string>,
  );
