import type { ContainerInfo, ImageFormat } from "@/types/image";
import type { MetadataSegment } from "@/types/metadata";
import type { AiTextSource } from "./ai/types";

/**
 * Everything a container yields that is worth summarising, normalised so the
 * inspector never needs to know which format it came from.
 */
export interface MetadataBundle {
  /** Raw TIFF payloads (starting at "II"/"MM"). */
  exifPayloads: Uint8Array[];
  xmpPackets: string[];
  xmpBytes: number;
  /** IPTC IIM payloads, already unwrapped from their 8BIM resource. */
  iptcPayloads: Uint8Array[];
  /** ICC profile payloads, already reassembled from multi-chunk carriers. */
  iccPayloads: Uint8Array[];
  c2paPayloads: Uint8Array[];
  c2paLocation?: string;
  aiSources: AiTextSource[];
  /** Free-text software identifier used by the provenance detector. */
  softwareHint?: string;
}

export function createBundle(): MetadataBundle {
  return {
    exifPayloads: [],
    xmpPackets: [],
    xmpBytes: 0,
    iptcPayloads: [],
    iccPayloads: [],
    c2paPayloads: [],
    aiSources: [],
  };
}

export interface ParsedContainer {
  format: ImageFormat;
  container: ContainerInfo;
  segments: MetadataSegment[];
  bundle: MetadataBundle;
  warnings: string[];
  /** False when this specific file cannot be cleaned without re-encoding. */
  losslessSupported: boolean;
  losslessBlockedReason?: string;
}
