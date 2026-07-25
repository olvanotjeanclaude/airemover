import type { ContainerInfo, ImageFormat } from "./image";

/**
 * What a physical region of the container holds. `structural` regions carry
 * pixel data or decoding parameters and are never candidates for removal.
 */
export type SegmentCategory =
  | "structural"
  | "exif"
  | "xmp"
  | "iptc"
  | "icc"
  | "c2pa"
  | "ai"
  | "comment"
  | "thumbnail"
  | "other";

/** The switches a user can flip. GPS is a sub-region of EXIF, not a segment. */
export type RemovableCategory =
  | "exif"
  | "gps"
  | "xmp"
  | "iptc"
  | "icc"
  | "c2pa"
  | "ai"
  | "comment"
  | "other";

export type RemovalOptions = Record<RemovableCategory, boolean>;

/**
 * A removable (or deliberately preserved) region of the original file, located
 * by absolute byte offset so the inspector can show exactly what will go.
 */
export interface MetadataSegment {
  id: string;
  category: SegmentCategory;
  /** Container-level name, e.g. "APP1", "iTXt", "EXIF", "uuid". */
  container: string;
  label: string;
  detail?: string;
  offset: number;
  /** Bytes the region occupies in the file, headers included. */
  size: number;
  /** Set when a region is kept even though it looks like metadata. */
  preservedReason?: string;
}

export interface ExifSummary {
  tagCount: number;
  byteOrder: "little" | "big";
  cameraMake?: string;
  cameraModel?: string;
  lens?: string;
  software?: string;
  dateTaken?: string;
  dateDigitized?: string;
  artist?: string;
  copyright?: string;
  description?: string;
  orientation?: number;
  exposureTime?: string;
  fNumber?: string;
  iso?: string;
  focalLength?: string;
  serialNumber?: string;
  bodySerialNumber?: string;
  lensSerialNumber?: string;
  ownerName?: string;
  userComment?: string;
  hasMakerNote: boolean;
  makerNoteBytes: number;
  hasThumbnail: boolean;
  thumbnailBytes: number;
}

export interface GpsSummary {
  latitude?: number;
  longitude?: number;
  altitude?: number;
  timestampUtc?: string;
  imageDirection?: string;
  /** Human-readable coordinate pair, e.g. "48.8584 N, 2.2945 E". */
  coordinates?: string;
  tagCount: number;
}

export interface IptcSummary {
  byline?: string;
  bylineTitle?: string;
  credit?: string;
  source?: string;
  copyrightNotice?: string;
  caption?: string;
  headline?: string;
  keywords?: string[];
  city?: string;
  country?: string;
  dateCreated?: string;
  fieldCount: number;
}

export interface IccSummary {
  description?: string;
  colorSpace?: string;
  deviceClass?: string;
  cmm?: string;
  version?: string;
  bytes: number;
}

export interface C2paSummary {
  /** Where the manifest store was found, e.g. "JPEG APP11 / JUMBF". */
  location: string;
  bytes: number;
  claimGenerator?: string;
  /** Assertion labels recovered from the JUMBF box tree. */
  assertions: string[];
  hasSignature: boolean;
}

export interface XmpSummary {
  packets: number;
  bytes: number;
  toolkit?: string;
  creator?: string;
  rights?: string;
  title?: string;
  description?: string;
  createDate?: string;
  documentId?: string;
  /** True when the packet carries C2PA / Content Credentials linkage. */
  hasProvenance: boolean;
}

export type AiGenerator =
  | "automatic1111"
  | "stable-diffusion"
  | "comfyui"
  | "fooocus"
  | "invokeai"
  | "novelai"
  | "flux"
  | "midjourney"
  | "adobe-firefly"
  | "openai"
  | "google-imagen"
  | "generic";

export interface AiMetadata {
  generator: AiGenerator;
  generatorLabel: string;
  /** `confirmed` when a generator-specific marker matched, `likely` otherwise. */
  confidence: "confirmed" | "likely";
  /** Human-readable origin, e.g. "PNG tEXt:parameters". */
  source: string;
  prompt?: string;
  negativePrompt?: string;
  seed?: string;
  steps?: string;
  cfgScale?: string;
  sampler?: string;
  scheduler?: string;
  model?: string;
  checkpoint?: string;
  vae?: string;
  clipSkip?: string;
  loras?: string[];
  controlNets?: string[];
  generationTime?: string;
  size?: string;
  version?: string;
  /** Every key/value recovered, for the raw view. */
  fields: Record<string, string>;
  bytes: number;
}

export interface InspectionReport {
  format: ImageFormat;
  container: ContainerInfo;
  fileSize: number;
  megapixels?: number;
  segments: MetadataSegment[];
  /** Total bytes classified as removable metadata under the current options. */
  metadataBytes: number;
  exif?: ExifSummary;
  gps?: GpsSummary;
  iptc?: IptcSummary;
  icc?: IccSummary;
  c2pa?: C2paSummary;
  xmp?: XmpSummary;
  ai: AiMetadata[];
  /** Non-fatal problems: truncated segments, bad CRCs, unsupported variants. */
  warnings: string[];
  /** True when a byte-level clean is possible for this exact file. */
  losslessSupported: boolean;
  /** Present when lossless is not possible, explaining why. */
  losslessBlockedReason?: string;
}

export interface CategoryPresence {
  category: RemovableCategory;
  present: boolean;
  bytes: number;
}
