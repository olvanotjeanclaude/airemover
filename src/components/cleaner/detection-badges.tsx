"use client";

import * as React from "react";
import {
  BrainCircuitIcon,
  CameraIcon,
  FileTextIcon,
  MapPinIcon,
  PaletteIcon,
  ShieldCheckIcon,
  TagsIcon,
} from "lucide-react";
import type { InspectionReport } from "@/types/metadata";
import { Badge } from "@/components/ui/badge";

export interface Detection {
  key: string;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
  variant: "default" | "warning" | "destructive" | "neutral";
  detail?: string;
}

/**
 * Turns a report into the short list of chips shown on a card. GPS and AI use
 * stronger colours because they are the findings people act on.
 */
export function detectionsOf(report: InspectionReport): Detection[] {
  const detections: Detection[] = [];

  if (report.gps) {
    detections.push({
      key: "gps",
      label: "GPS",
      Icon: MapPinIcon,
      variant: "destructive",
      detail: report.gps.coordinates,
    });
  }

  if (report.ai.length > 0) {
    detections.push({
      key: "ai",
      label: report.ai[0].generatorLabel,
      Icon: BrainCircuitIcon,
      variant: "warning",
      detail: report.ai[0].prompt?.slice(0, 90),
    });
  }

  if (report.c2pa) {
    detections.push({
      key: "c2pa",
      label: "C2PA",
      Icon: ShieldCheckIcon,
      variant: "warning",
      detail: report.c2pa.claimGenerator,
    });
  }

  if (report.exif) {
    const camera = [report.exif.cameraMake, report.exif.cameraModel]
      .filter(Boolean)
      .join(" ");
    detections.push({
      key: "exif",
      label: "EXIF",
      Icon: CameraIcon,
      variant: "default",
      detail: camera || `${report.exif.tagCount} tags`,
    });
  }

  if (report.xmp) {
    detections.push({ key: "xmp", label: "XMP", Icon: FileTextIcon, variant: "neutral" });
  }

  if (report.iptc) {
    detections.push({ key: "iptc", label: "IPTC", Icon: TagsIcon, variant: "neutral" });
  }

  if (report.icc) {
    detections.push({
      key: "icc",
      label: "ICC",
      Icon: PaletteIcon,
      variant: "neutral",
      detail: report.icc.description,
    });
  }

  return detections;
}

export function DetectionBadges({
  report,
  limit,
}: {
  report: InspectionReport;
  limit?: number;
}) {
  const detections = detectionsOf(report);
  if (detections.length === 0) {
    return (
      <Badge variant="success">
        <ShieldCheckIcon />
        No metadata found
      </Badge>
    );
  }

  const shown = limit ? detections.slice(0, limit) : detections;
  const hidden = detections.length - shown.length;

  return (
    <>
      {shown.map(({ key, label, Icon, variant }) => (
        <Badge key={key} variant={variant}>
          <Icon />
          {label}
        </Badge>
      ))}
      {hidden > 0 ? <Badge variant="neutral">+{hidden}</Badge> : null}
    </>
  );
}
