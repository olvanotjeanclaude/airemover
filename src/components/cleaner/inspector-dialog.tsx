"use client";

import * as React from "react";
import { ArrowRightIcon, CheckCircle2Icon, DownloadIcon, ShieldCheckIcon } from "lucide-react";
import { CATEGORY_LABELS } from "@/constants/categories";
import { formatBytes, formatPercent } from "@/lib/image/utils/size";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { FileEntry } from "@/store/files-store";
import { InspectorReport } from "./inspector-report";

export interface InspectorDialogProps {
  entry: FileEntry | null;
  onClose: () => void;
  onDownload: (entry: FileEntry) => void;
}

export function InspectorDialog({ entry, onClose, onDownload }: InspectorDialogProps) {
  if (!entry?.report) return null;

  const summary = entry.summary;
  // Remounting on this key moves the view to the results the moment a clean
  // finishes, without an effect that writes state during render.
  const tabsKey = `${entry.id}:${summary ? "after" : "before"}`;

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent aria-describedby="inspector-description">
        <DialogHeader>
          <DialogTitle className="truncate">{entry.name}</DialogTitle>
          <DialogDescription id="inspector-description">
            Everything embedded in this file, read locally. Nothing here was sent anywhere.
          </DialogDescription>
        </DialogHeader>

        <Tabs
          key={tabsKey}
          defaultValue={summary ? "after" : "before"}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="border-b border-border px-6 py-3">
            <TabsList>
              <TabsTrigger value="before">Before cleaning</TabsTrigger>
              <TabsTrigger value="after" disabled={!summary}>
                After cleaning
              </TabsTrigger>
            </TabsList>
          </div>

          <ScrollArea className="min-h-0 flex-1">
            <TabsContent value="before" className="p-6">
              <InspectorReport report={entry.report} />
            </TabsContent>

            <TabsContent value="after" className="p-6">
              {summary ? (
                <div className="flex flex-col gap-4">
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <Stat label="Original" value={formatBytes(summary.originalSize)} />
                    <Stat label="Cleaned" value={formatBytes(summary.cleanedSize)} />
                    <Stat
                      label="Bytes removed"
                      value={formatBytes(summary.bytesRemoved)}
                      tone="success"
                    />
                    <Stat
                      label="Reduction"
                      value={formatPercent(summary.percentReduction)}
                      tone="success"
                    />
                  </div>

                  <div className="rounded-xl border border-border bg-surface p-4">
                    <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                      <CheckCircle2Icon className="size-4 text-success" />
                      Removed
                    </h4>
                    {summary.removed.length > 0 ? (
                      <ul className="flex flex-col gap-2">
                        {summary.removed.map((stat) => (
                          <li
                            key={stat.category}
                            className="flex items-center justify-between gap-4 text-sm"
                          >
                            <span>
                              {CATEGORY_LABELS[stat.category] ?? stat.category}
                              <span className="ml-2 text-xs text-muted-foreground">
                                {stat.count} block{stat.count === 1 ? "" : "s"}
                              </span>
                            </span>
                            <span className="tabular text-sm text-muted-foreground">
                              {formatBytes(stat.bytes)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Nothing needed removing. The file was already clean.
                      </p>
                    )}
                  </div>

                  {summary.remaining.length > 0 ? (
                    <div className="rounded-xl border border-border bg-surface p-4">
                      <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                        <ShieldCheckIcon className="size-4 text-primary" />
                        Remaining
                      </h4>
                      <ul className="flex flex-col gap-2">
                        {summary.remaining.map((item, index) => (
                          <li key={`${item.label}-${index}`} className="text-sm">
                            <div className="flex items-center justify-between gap-4">
                              <span>{item.label}</span>
                              <span className="tabular text-sm text-muted-foreground">
                                {formatBytes(item.bytes)}
                              </span>
                            </div>
                            <p className="text-xs text-muted-foreground">{item.reason}</p>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={summary.pixelStreamPreserved ? "success" : "warning"}>
                      {summary.pixelStreamPreserved
                        ? "Compressed image stream copied byte for byte"
                        : "Image was decoded and re-encoded"}
                    </Badge>
                    <Badge variant="neutral">
                      Output: {summary.outputFormat.toUpperCase()}
                    </Badge>
                  </div>

                  {summary.warnings.length > 0 ? (
                    <ul className="space-y-1.5 text-sm text-muted-foreground">
                      {summary.warnings.map((warning, index) => (
                        <li key={index}>{warning}</li>
                      ))}
                    </ul>
                  ) : null}

                  <div className="border-t border-border pt-4">
                    <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                      <ArrowRightIcon className="size-4 text-primary" />
                      Verified contents of the cleaned file
                    </h4>
                    <InspectorReport report={summary.verification} />
                  </div>
                </div>
              ) : null}
            </TabsContent>
          </ScrollArea>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          {entry.status === "done" ? (
            <Button onClick={() => onDownload(entry)}>
              <DownloadIcon />
              Download cleaned file
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "success";
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p
        className={
          tone === "success"
            ? "tabular mt-1 text-lg font-semibold text-success"
            : "tabular mt-1 text-lg font-semibold"
        }
      >
        {value}
      </p>
    </div>
  );
}
