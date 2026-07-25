import type { C2paSummary } from "@/types/metadata";
import { scanJumbf } from "./jumbf";

export {
  C2PA_BMFF_UUID,
  isC2paUuid,
  looksLikeJumbf,
  scanJumbf,
  type JumbfBox,
  type JumbfScan,
} from "./jumbf";

/** Container-specific identifiers that carry a C2PA manifest store. */
export const C2PA_PNG_CHUNK = "caBX";
export const C2PA_WEBP_CHUNK = "C2PA";
/** APP11 payloads begin with this JPEG Universal Box identifier. */
export const C2PA_JPEG_IDENTIFIER = "JP";
/** DNG / TIFF store the manifest in a private tag. */
export const C2PA_TIFF_TAG = 0xcd41;

export function summarizeC2pa(
  payloads: readonly Uint8Array[],
  location: string,
): C2paSummary {
  let bytes = 0;
  const assertions: string[] = [];
  let claimGenerator: string | undefined;
  let hasSignature = false;

  for (const payload of payloads) {
    bytes += payload.length;
    const scan = scanJumbf(payload);
    for (const label of scan.labels) {
      if (!assertions.includes(label)) assertions.push(label);
    }
    if (!claimGenerator && scan.claimGenerator) {
      claimGenerator = scan.claimGenerator;
    }
    hasSignature = hasSignature || scan.hasSignature;
  }

  return { location, bytes, claimGenerator, assertions, hasSignature };
}
