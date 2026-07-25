"use client";

import * as React from "react";
import {
  DownloadIcon,
  Loader2Icon,
  PauseIcon,
  PlayIcon,
  RotateCcwIcon,
  Settings2Icon,
  SparklesIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { formatBytes, formatPercent } from "@/lib/image/utils/size";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { FileStatus } from "@/types/processing";
import type { QueueState } from "@/store/files-store";
import { SettingsPanel } from "./settings-panel";

export interface CleanerToolbarProps {
  total: number;
  counts: Record<FileStatus, number>;
  progress: number;
  bytesRemoved: number;
  queueState: QueueState;
  isZipping: boolean;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
  onRetryFailed: () => void;
  onDownloadAll: () => void;
  onClear: () => void;
}

export function CleanerToolbar({
  total,
  counts,
  progress,
  bytesRemoved,
  queueState,
  isZipping,
  onStart,
  onPause,
  onResume,
  onCancel,
  onRetryFailed,
  onDownloadAll,
  onClear,
}: CleanerToolbarProps) {
  const [settingsOpen, setSettingsOpen] = React.useState(false);

  const readyToRun = counts.pending > 0;
  const isRunning = queueState === "running";
  const isPaused = queueState === "paused";
  const savedPercent =
    counts.done > 0 && bytesRemoved > 0 ? formatBytes(bytesRemoved) : null;

  return (
    <div className="sticky top-0 z-30 -mx-1 px-1 py-3">
      <div className="glass-panel flex flex-col gap-3 rounded-xl p-3 shadow-soft">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2">
            {isRunning ? (
              <Button onClick={onPause} variant="secondary">
                <PauseIcon />
                Pause
              </Button>
            ) : isPaused ? (
              <Button onClick={onResume}>
                <PlayIcon />
                Resume
              </Button>
            ) : (
              <Button onClick={onStart} disabled={!readyToRun}>
                <SparklesIcon />
                Clean {counts.pending > 0 ? counts.pending : ""} {counts.pending === 1 ? "image" : "images"}
              </Button>
            )}

            {isRunning || isPaused ? (
              <Button onClick={onCancel} variant="outline" aria-label="Cancel processing">
                <XIcon />
                Cancel
              </Button>
            ) : null}
          </div>

          <div className="mx-1 hidden h-6 w-px bg-border sm:block" />

          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="neutral">{total} queued</Badge>
            {counts.done > 0 ? <Badge variant="success">{counts.done} cleaned</Badge> : null}
            {counts.failed > 0 ? (
              <Badge variant="destructive">{counts.failed} failed</Badge>
            ) : null}
            {savedPercent ? <Badge variant="neutral">{savedPercent} removed</Badge> : null}
          </div>

          <div className="ml-auto flex items-center gap-2">
            {counts.failed > 0 || counts.cancelled > 0 ? (
              <Button variant="ghost" size="sm" onClick={onRetryFailed}>
                <RotateCcwIcon />
                Retry failed
              </Button>
            ) : null}

            <Button
              variant="outline"
              size="sm"
              onClick={() => setSettingsOpen(true)}
              aria-label="Open cleaning settings"
            >
              <Settings2Icon />
              Settings
            </Button>

            <Button
              size="sm"
              onClick={onDownloadAll}
              disabled={counts.done === 0 || isZipping}
            >
              {isZipping ? <Loader2Icon className="animate-spin" /> : <DownloadIcon />}
              {counts.done > 1 ? "Download all" : "Download"}
            </Button>

            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onClear}
              aria-label="Clear the queue"
            >
              <Trash2Icon />
            </Button>
          </div>
        </div>

        <div className={cn("flex items-center gap-3", total === 0 && "hidden")}>
          <Progress
            value={Math.round(progress * 100)}
            aria-label="Overall progress"
            className="flex-1"
          />
          <span className="tabular w-12 shrink-0 text-right text-xs font-medium text-muted-foreground">
            {formatPercent(progress * 100, 0)}
          </span>
        </div>
      </div>

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="w-[min(38rem,calc(100vw-2rem))]">
          <DialogHeader>
            <DialogTitle>Cleaning settings</DialogTitle>
            <DialogDescription>
              Applies to every file processed from now on. Saved in this browser only.
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[70vh]">
            <div className="p-6">
              <SettingsPanel />
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}
