import type {
  AiMetadata,
  InspectionReport,
  RemovableCategory,
} from "@/types/metadata";
import { summarizeC2pa } from "../c2pa";
import { parseTiff, summarizeExif, summarizeGps } from "../exif";
import { summarizeIcc } from "../icc";
import { parseIptcRecords, summarizeIptc } from "../iptc";
import { detectAiMetadata, detectProvenanceGenerator } from "../parser/ai";
import { readXmpProperty, summarizeXmp } from "../xmp";
import type { ParsedContainer } from "../parser/types";
import { switchForSegment } from "../cleaner/types";
import { megapixelsOf } from "../utils/size";

/**
 * Turns a container-specific parse into the format-agnostic report the UI and
 * the verification step both consume.
 */
export function buildReport(
  parsed: ParsedContainer,
  fileSize: number,
): InspectionReport {
  const warnings = [...parsed.warnings];

  let exif: InspectionReport["exif"];
  let gps: InspectionReport["gps"];
  if (parsed.bundle.exifPayloads.length > 0) {
    try {
      const tree = parseTiff(parsed.bundle.exifPayloads[0]);
      exif = summarizeExif(tree);
      gps = summarizeGps(tree);
      warnings.push(...tree.warnings);
    } catch (error) {
      warnings.push(
        `EXIF could not be read (${error instanceof Error ? error.message : "unknown error"}); it will still be removed`,
      );
    }
  }

  let iptc: InspectionReport["iptc"];
  if (parsed.bundle.iptcPayloads.length > 0) {
    const records = parsed.bundle.iptcPayloads.flatMap((payload) =>
      parseIptcRecords(payload),
    );
    if (records.length > 0) iptc = summarizeIptc(records);
  }

  const icc =
    parsed.bundle.iccPayloads.length > 0
      ? summarizeIcc(parsed.bundle.iccPayloads[0])
      : undefined;

  const c2pa =
    parsed.bundle.c2paPayloads.length > 0
      ? summarizeC2pa(
          parsed.bundle.c2paPayloads,
          parsed.bundle.c2paLocation ?? "Embedded manifest",
        )
      : undefined;

  const xmp =
    parsed.bundle.xmpPackets.length > 0
      ? summarizeXmp(parsed.bundle.xmpPackets, parsed.bundle.xmpBytes)
      : undefined;

  const ai = collectAi(parsed, exif?.software ?? parsed.bundle.softwareHint, c2pa);

  const metadataBytes = parsed.segments.reduce((total, segment) => {
    const category = switchForSegment(segment.category);
    return category === null ? total : total + segment.size;
  }, 0);

  return {
    format: parsed.format,
    container: parsed.container,
    fileSize,
    megapixels: megapixelsOf(parsed.container.width, parsed.container.height),
    segments: parsed.segments,
    metadataBytes,
    exif,
    gps,
    iptc,
    icc,
    c2pa,
    xmp,
    ai,
    warnings,
    losslessSupported: parsed.losslessSupported,
    losslessBlockedReason: parsed.losslessBlockedReason,
  };
}

function collectAi(
  parsed: ParsedContainer,
  software: string | undefined,
  c2pa: InspectionReport["c2pa"],
): AiMetadata[] {
  const found = detectAiMetadata(parsed.bundle.aiSources);

  const joinedXmp = parsed.bundle.xmpPackets.join("\n");
  const provenance = detectProvenanceGenerator({
    origin: c2pa ? c2pa.location : "XMP / software fields",
    bytes: c2pa?.bytes ?? 0,
    claimGenerator: c2pa?.claimGenerator,
    creatorTool: joinedXmp ? readXmpProperty(joinedXmp, "xmp:CreatorTool") : undefined,
    digitalSourceType: joinedXmp
      ? readXmpProperty(joinedXmp, "Iptc4xmpExt:DigitalSourceType")
      : undefined,
    software,
    assertions: c2pa?.assertions,
  });

  if (!provenance) return found;

  const alreadyKnown = found.some(
    (entry) => entry.generator === provenance.generator,
  );
  if (alreadyKnown) {
    // Upgrade the existing entry with the provenance fields it lacks.
    const target = found.find((entry) => entry.generator === provenance.generator);
    if (target) {
      target.fields = { ...provenance.fields, ...target.fields };
      if (provenance.confidence === "confirmed") target.confidence = "confirmed";
    }
    return found;
  }

  return [...found, provenance];
}

/** Bytes per switch, so the UI can show what each toggle would actually remove. */
export function categoryBreakdown(
  report: InspectionReport,
): Map<RemovableCategory, number> {
  const totals = new Map<RemovableCategory, number>();
  for (const segment of report.segments) {
    const category = switchForSegment(segment.category);
    if (category === null) continue;
    totals.set(category, (totals.get(category) ?? 0) + segment.size);
  }
  if (report.gps && report.gps.tagCount > 0 && !totals.has("gps")) {
    totals.set("gps", 0);
  }
  return totals;
}

export function hasAnyMetadata(report: InspectionReport): boolean {
  return (
    report.metadataBytes > 0 ||
    report.ai.length > 0 ||
    Boolean(report.gps) ||
    Boolean(report.c2pa)
  );
}
