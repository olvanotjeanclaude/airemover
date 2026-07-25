"use client";

import * as React from "react";
import { motion } from "framer-motion";
import {
  AlertTriangleIcon,
  CheckIcon,
  DownloadIcon,
  FileImageIcon,
  Loader2Icon,
  RotateCcwIcon,
  SearchIcon,
  Trash2Icon,
} from "lucide-react";
import { describeFormat } from "@/lib/image/utils/format";
import { formatBytes, formatPercent } from "@/lib/image/utils/size";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { FileEntry } from "@/store/files-store";
import { DetectionBadges } from "./detection-badges";

export interface FileCardProps {
  entry: FileEntry;
  onInspect: (id: string) => void;
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
  onDownload: (entry: FileEntry) => void;
}

const STATUS_TEXT: Record<FileEntry["status"], string> = {
  pending: "Ready",
  analyzing: "Analysing",
  queued: "Queued",
  processing: "Cleaning",
  done: "Cleaned",
  failed: "Failed",
  skipped: "Skipped",
  cancelled: "Cancelled",
};

export const FileCard = React.memo(function FileCard({
  entry,
  onInspect,
  onRemove,
  onRetry,
  onDownload,
}: FileCardProps) {
  const busy = entry.status === "analyzing" || entry.status === "processing";
  const format = entry.report ? describeFormat(entry.report.format) : null;
  const dimensions = entry.report?.container;

  return (
    <motion.li
      layout="position"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.18 }}
      className={cn(
        "group relative flex gap-4 rounded-xl border border-border bg-card p-3 shadow-soft transition-shadow hover:shadow-lift",
        entry.status === "failed" && "border-destructive/40",
        entry.status === "done" && "border-success/35",
      )}
    >
      <div className="relative size-24 shrink-0 overflow-hidden rounded-lg bg-surface-sunken">
        {entry.thumbnailUrl ? (
          // A local object URL of the user's own file; next/image would proxy it.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={entry.thumbnailUrl}
            alt=""
            className="size-full object-cover"
            loading="lazy"
            decoding="async"
          />
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-1 text-muted-foreground">
            <FileImageIcon className="size-6" />
            <span className="text-[0.65rem] font-medium uppercase tracking-wide">
              {format?.label ?? "?"}
            </span>
          </div>
        )}

        {entry.status === "done" ? (
          <span className="absolute bottom-1 right-1 flex size-6 items-center justify-center rounded-full bg-success text-success-foreground shadow-sm">
            <CheckIcon className="size-3.5" strokeWidth={3} />
          </span>
        ) : null}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium" title={entry.name}>
              {entry.name}
            </p>
            <p className="tabular mt-0.5 truncate text-xs text-muted-foreground">
              {formatBytes(entry.size)}
              {dimensions?.width && dimensions.height
                ? ` · ${dimensions.width}x${dimensions.height}`
                : ""}
              {format ? ` · ${format.label}` : ""}
              {entry.report?.megapixels ? ` · ${entry.report.megapixels.toFixed(1)} MP` : ""}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-0.5">
            {entry.report ? (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => onInspect(entry.id)}
                aria-label={`Inspect metadata in ${entry.name}`}
              >
                <SearchIcon />
              </Button>
            ) : null}
            {entry.status === "done" ? (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => onDownload(entry)}
                aria-label={`Download cleaned ${entry.name}`}
              >
                <DownloadIcon />
              </Button>
            ) : null}
            {entry.status === "failed" || entry.status === "cancelled" ? (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => onRetry(entry.id)}
                aria-label={`Retry ${entry.name}`}
              >
                <RotateCcwIcon />
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => onRemove(entry.id)}
              aria-label={`Remove ${entry.name} from the queue`}
            >
              <Trash2Icon />
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {entry.status === "failed" ? (
            <Badge variant="destructive">
              <AlertTriangleIcon />
              {entry.error?.message ?? "Failed"}
            </Badge>
          ) : entry.summary ? (
            <>
              <Badge variant="success">
                <CheckIcon />
                {formatBytes(entry.summary.bytesRemoved)} removed
              </Badge>
              <Badge variant="neutral">
                {formatPercent(entry.summary.percentReduction)} smaller
              </Badge>
              {entry.summary.pixelStreamPreserved ? (
                <Badge variant="neutral">Pixels untouched</Badge>
              ) : (
                <Badge variant="warning">Re-encoded</Badge>
              )}
            </>
          ) : entry.report ? (
            <DetectionBadges report={entry.report} limit={4} />
          ) : (
            <Badge variant="neutral">
              <Loader2Icon className="animate-spin" />
              Reading metadata
            </Badge>
          )}
        </div>

        <div className="mt-auto flex items-center gap-3">
          <Progress
            value={Math.round(entry.progress * 100)}
            indeterminate={entry.status === "analyzing"}
            className={cn(busy ? "opacity-100" : "opacity-0")}
            aria-label={`${entry.name} progress`}
          />
          <span
            className={cn(
              "shrink-0 text-xs font-medium",
              entry.status === "failed" && "text-destructive",
              entry.status === "done" && "text-success",
              busy && "text-primary",
              !busy && entry.status !== "done" && entry.status !== "failed" && "text-muted-foreground",
            )}
          >
            {entry.stage ?? STATUS_TEXT[entry.status]}
          </span>
        </div>
      </div>
    </motion.li>
  );
});
