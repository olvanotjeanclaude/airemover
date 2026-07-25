"use client";

import * as React from "react";
import {
  BrainCircuitIcon,
  CameraIcon,
  FileTextIcon,
  ImageIcon,
  MapPinIcon,
  PaletteIcon,
  ShieldCheckIcon,
  TagsIcon,
  TriangleAlertIcon,
} from "lucide-react";
import type { InspectionReport } from "@/types/metadata";
import { orientationLabel } from "@/lib/image/exif";
import { describeFormat } from "@/lib/image/utils/format";
import { formatBytes, formatMegapixels } from "@/lib/image/utils/size";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

function Field({ label, value }: { label: string; value?: React.ReactNode }) {
  if (value === undefined || value === null || value === "") return null;
  return (
    <div className="flex flex-col gap-0.5 py-1.5">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="break-words text-sm">{value}</dd>
    </div>
  );
}

function Section({
  title,
  Icon,
  badge,
  children,
}: {
  title: string;
  Icon: React.ComponentType<{ className?: string }>;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-surface p-4">
      <header className="mb-2 flex items-center gap-2">
        <Icon className="size-4 text-primary" />
        <h4 className="text-sm font-semibold">{title}</h4>
        {badge}
      </header>
      {children}
    </section>
  );
}

const GRID = "grid grid-cols-1 gap-x-6 sm:grid-cols-2";

export function InspectorReport({ report }: { report: InspectionReport }) {
  const format = describeFormat(report.format);
  const container = report.container;

  return (
    <div className="flex flex-col gap-4">
      <Section title="File" Icon={ImageIcon}>
        <dl className={GRID}>
          <Field label="Format" value={`${format.label} (${format.mimeType})`} />
          <Field label="Encoding" value={container.encoding} />
          <Field
            label="Dimensions"
            value={
              container.width && container.height
                ? `${container.width} x ${container.height} px`
                : "Unknown"
            }
          />
          <Field label="Megapixels" value={formatMegapixels(container.width, container.height)} />
          <Field label="File size" value={formatBytes(report.fileSize)} />
          <Field
            label="Metadata size"
            value={
              report.metadataBytes > 0
                ? `${formatBytes(report.metadataBytes)} (${(
                    (report.metadataBytes / Math.max(1, report.fileSize)) *
                    100
                  ).toFixed(1)}% of the file)`
                : "None"
            }
          />
          <Field label="Colour space" value={container.colorSpace} />
          <Field
            label="Bit depth"
            value={container.bitDepth ? `${container.bitDepth}-bit` : undefined}
          />
          <Field label="Channels" value={container.channels} />
          <Field
            label="Alpha"
            value={container.hasAlpha === undefined ? undefined : container.hasAlpha ? "Yes" : "No"}
          />
          <Field
            label="Progressive"
            value={
              container.isProgressive === undefined
                ? undefined
                : container.isProgressive
                  ? "Yes"
                  : "No"
            }
          />
          <Field
            label="Animated"
            value={container.isAnimated ? "Yes" : undefined}
          />
        </dl>
      </Section>

      {report.ai.map((ai, index) => (
        <Section
          key={`${ai.generator}-${index}`}
          title={`AI generation data: ${ai.generatorLabel}`}
          Icon={BrainCircuitIcon}
          badge={
            <Badge variant={ai.confidence === "confirmed" ? "warning" : "neutral"}>
              {ai.confidence === "confirmed" ? "Confirmed" : "Likely"}
            </Badge>
          }
        >
          {ai.prompt ? (
            <div className="mb-3">
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Prompt
              </p>
              <p className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg bg-surface-sunken p-3 font-mono text-xs leading-relaxed">
                {ai.prompt}
              </p>
            </div>
          ) : null}
          {ai.negativePrompt ? (
            <div className="mb-3">
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Negative prompt
              </p>
              <p className="max-h-28 overflow-y-auto whitespace-pre-wrap rounded-lg bg-surface-sunken p-3 font-mono text-xs leading-relaxed">
                {ai.negativePrompt}
              </p>
            </div>
          ) : null}
          <dl className={GRID}>
            <Field label="Source" value={ai.source} />
            <Field label="Seed" value={ai.seed} />
            <Field label="Steps" value={ai.steps} />
            <Field label="CFG scale" value={ai.cfgScale} />
            <Field label="Sampler" value={ai.sampler} />
            <Field label="Scheduler" value={ai.scheduler} />
            <Field label="Model" value={ai.model} />
            <Field label="Checkpoint" value={ai.checkpoint} />
            <Field label="VAE" value={ai.vae} />
            <Field label="Clip skip" value={ai.clipSkip} />
            <Field label="LoRA" value={ai.loras?.join(", ")} />
            <Field label="ControlNet" value={ai.controlNets?.join(", ")} />
            <Field label="Size" value={ai.size} />
            <Field label="Version" value={ai.version} />
            <Field label="Generation time" value={ai.generationTime} />
          </dl>
        </Section>
      ))}

      {report.gps ? (
        <Section
          title="GPS location"
          Icon={MapPinIcon}
          badge={<Badge variant="destructive">{report.gps.tagCount} tags</Badge>}
        >
          <dl className={GRID}>
            <Field label="Coordinates" value={report.gps.coordinates} />
            <Field
              label="Latitude / longitude"
              value={
                report.gps.latitude !== undefined && report.gps.longitude !== undefined
                  ? `${report.gps.latitude}, ${report.gps.longitude}`
                  : undefined
              }
            />
            <Field
              label="Altitude"
              value={report.gps.altitude === undefined ? undefined : `${report.gps.altitude} m`}
            />
            <Field label="Timestamp" value={report.gps.timestampUtc} />
            <Field label="Direction" value={report.gps.imageDirection} />
          </dl>
        </Section>
      ) : null}

      {report.exif ? (
        <Section
          title="EXIF"
          Icon={CameraIcon}
          badge={<Badge variant="neutral">{report.exif.tagCount} tags</Badge>}
        >
          <dl className={GRID}>
            <Field label="Camera" value={[report.exif.cameraMake, report.exif.cameraModel].filter(Boolean).join(" ")} />
            <Field label="Lens" value={report.exif.lens} />
            <Field label="Software" value={report.exif.software} />
            <Field label="Date taken" value={report.exif.dateTaken} />
            <Field label="Date digitised" value={report.exif.dateDigitized} />
            <Field label="Author" value={report.exif.artist} />
            <Field label="Copyright" value={report.exif.copyright} />
            <Field label="Description" value={report.exif.description} />
            <Field label="Orientation" value={orientationLabel(report.exif.orientation)} />
            <Field label="Exposure" value={report.exif.exposureTime} />
            <Field label="Aperture" value={report.exif.fNumber} />
            <Field label="ISO" value={report.exif.iso} />
            <Field label="Focal length" value={report.exif.focalLength} />
            <Field label="Body serial" value={report.exif.bodySerialNumber ?? report.exif.serialNumber} />
            <Field label="Lens serial" value={report.exif.lensSerialNumber} />
            <Field label="Owner" value={report.exif.ownerName} />
            <Field label="User comment" value={report.exif.userComment} />
            <Field
              label="Maker notes"
              value={report.exif.hasMakerNote ? formatBytes(report.exif.makerNoteBytes) : undefined}
            />
            <Field
              label="Embedded thumbnail"
              value={report.exif.hasThumbnail ? formatBytes(report.exif.thumbnailBytes) : undefined}
            />
          </dl>
        </Section>
      ) : null}

      {report.xmp ? (
        <Section
          title="XMP"
          Icon={FileTextIcon}
          badge={<Badge variant="neutral">{formatBytes(report.xmp.bytes)}</Badge>}
        >
          <dl className={GRID}>
            <Field label="Packets" value={report.xmp.packets} />
            <Field label="Toolkit" value={report.xmp.toolkit} />
            <Field label="Creator" value={report.xmp.creator} />
            <Field label="Title" value={report.xmp.title} />
            <Field label="Rights" value={report.xmp.rights} />
            <Field label="Created" value={report.xmp.createDate} />
            <Field label="Document ID" value={report.xmp.documentId} />
            <Field label="Description" value={report.xmp.description} />
            <Field
              label="Provenance links"
              value={report.xmp.hasProvenance ? "Present" : undefined}
            />
          </dl>
        </Section>
      ) : null}

      {report.iptc ? (
        <Section
          title="IPTC"
          Icon={TagsIcon}
          badge={<Badge variant="neutral">{report.iptc.fieldCount} fields</Badge>}
        >
          <dl className={GRID}>
            <Field label="Byline" value={report.iptc.byline} />
            <Field label="Byline title" value={report.iptc.bylineTitle} />
            <Field label="Credit" value={report.iptc.credit} />
            <Field label="Source" value={report.iptc.source} />
            <Field label="Copyright" value={report.iptc.copyrightNotice} />
            <Field label="Headline" value={report.iptc.headline} />
            <Field label="Caption" value={report.iptc.caption} />
            <Field label="Keywords" value={report.iptc.keywords?.join(", ")} />
            <Field label="City" value={report.iptc.city} />
            <Field label="Country" value={report.iptc.country} />
            <Field label="Date created" value={report.iptc.dateCreated} />
          </dl>
        </Section>
      ) : null}

      {report.c2pa ? (
        <Section
          title="C2PA Content Credentials"
          Icon={ShieldCheckIcon}
          badge={<Badge variant="warning">{formatBytes(report.c2pa.bytes)}</Badge>}
        >
          <dl className={GRID}>
            <Field label="Location" value={report.c2pa.location} />
            <Field label="Claim generator" value={report.c2pa.claimGenerator} />
            <Field label="Signed" value={report.c2pa.hasSignature ? "Yes" : "No"} />
            <Field
              label="Assertions"
              value={
                report.c2pa.assertions.length > 0
                  ? report.c2pa.assertions.join(", ")
                  : undefined
              }
            />
          </dl>
        </Section>
      ) : null}

      {report.icc ? (
        <Section
          title="ICC colour profile"
          Icon={PaletteIcon}
          badge={<Badge variant="neutral">{formatBytes(report.icc.bytes)}</Badge>}
        >
          <dl className={GRID}>
            <Field label="Description" value={report.icc.description} />
            <Field label="Colour space" value={report.icc.colorSpace} />
            <Field label="Device class" value={report.icc.deviceClass} />
            <Field label="Version" value={report.icc.version} />
            <Field label="CMM" value={report.icc.cmm} />
          </dl>
        </Section>
      ) : null}

      {report.segments.length > 0 ? (
        <Section title="Metadata blocks" Icon={FileTextIcon}>
          <ul className="divide-y divide-border">
            {report.segments.map((segment) => (
              <li
                key={segment.id}
                className="flex items-center justify-between gap-4 py-2 text-sm"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{segment.label}</p>
                  <p className="tabular truncate text-xs text-muted-foreground">
                    {segment.container} at offset {segment.offset}
                    {segment.detail ? ` · ${segment.detail}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {segment.preservedReason ? (
                    <Badge variant="neutral" title={segment.preservedReason}>
                      Kept
                    </Badge>
                  ) : null}
                  <span className="tabular text-xs text-muted-foreground">
                    {formatBytes(segment.size)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {report.warnings.length > 0 ? (
        <Section title="Notes" Icon={TriangleAlertIcon}>
          <ul className="space-y-1.5 text-sm text-muted-foreground">
            {report.warnings.map((warning, index) => (
              <li key={index} className="flex gap-2">
                <span aria-hidden className="text-warning">
                  &bull;
                </span>
                {warning}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {!report.losslessSupported ? (
        <>
          <Separator />
          <p className={cn("text-sm text-warning")}>
            {report.losslessBlockedReason ??
              "This file cannot be cleaned without re-encoding."}{" "}
            Switch to rebuild mode to process it.
          </p>
        </>
      ) : null}
    </div>
  );
}
