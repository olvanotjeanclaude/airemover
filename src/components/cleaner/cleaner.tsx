"use client";

import * as React from "react";
import { AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { MAX_FILES } from "@/constants/limits";
import { useDownloads } from "@/hooks/use-downloads";
import { usePasteImages } from "@/hooks/use-paste";
import { useProcessingQueue } from "@/hooks/use-processing-queue";
import {
  countByStatus,
  overallProgress,
  totalBytesRemoved,
  useFilesStore,
} from "@/store/files-store";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CleanerToolbar } from "./cleaner-toolbar";
import { FileCard } from "./file-card";
import { InspectorDialog } from "./inspector-dialog";
import { UploadZone } from "./upload-zone";

export function Cleaner() {
  const files = useFilesStore((state) => state.files);
  const queueState = useFilesStore((state) => state.queueState);
  const inspectedId = useFilesStore((state) => state.inspectedId);
  const addFiles = useFilesStore((state) => state.addFiles);
  const removeFile = useFilesStore((state) => state.removeFile);
  const clearAll = useFilesStore((state) => state.clearAll);
  const retry = useFilesStore((state) => state.retry);
  const inspect = useFilesStore((state) => state.inspect);

  const { start, pause, resume, cancel, retryFailed } = useProcessingQueue();
  const { downloadOne, downloadAll, isZipping } = useDownloads();

  const handleFiles = React.useCallback(
    (incoming: File[]) => {
      const { added, rejected } = addFiles(incoming);
      if (added > 0) {
        toast.success(`Added ${added} image${added === 1 ? "" : "s"}.`);
      }
      if (rejected > 0) {
        toast.warning(
          added === 0
            ? `Those images are already queued, or the ${MAX_FILES}-file limit was reached.`
            : `${rejected} were skipped as duplicates or over the ${MAX_FILES}-file limit.`,
        );
      }
    },
    [addFiles],
  );

  usePasteImages(handleFiles);

  const counts = React.useMemo(() => countByStatus(files), [files]);
  const progress = React.useMemo(() => overallProgress(files), [files]);
  const removedBytes = React.useMemo(() => totalBytesRemoved(files), [files]);
  const inspected = React.useMemo(
    () => files.find((entry) => entry.id === inspectedId) ?? null,
    [files, inspectedId],
  );

  const handleClear = React.useCallback(() => {
    if (queueState === "running") cancel();
    clearAll();
  }, [cancel, clearAll, queueState]);

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex flex-col gap-4">
        {files.length === 0 ? (
          <UploadZone onFiles={handleFiles} remainingSlots={MAX_FILES} />
        ) : (
          <>
            <CleanerToolbar
              total={files.length}
              counts={counts}
              progress={progress}
              bytesRemoved={removedBytes}
              queueState={queueState}
              isZipping={isZipping}
              onStart={start}
              onPause={pause}
              onResume={resume}
              onCancel={cancel}
              onRetryFailed={retryFailed}
              onDownloadAll={downloadAll}
              onClear={handleClear}
            />

            <UploadZone
              compact
              onFiles={handleFiles}
              remainingSlots={MAX_FILES - files.length}
            />

            <ul
              className="grid grid-cols-1 gap-3 lg:grid-cols-2"
              aria-label={`${files.length} images in the queue`}
            >
              <AnimatePresence initial={false}>
                {files.map((entry) => (
                  <FileCard
                    key={entry.id}
                    entry={entry}
                    onInspect={inspect}
                    onRemove={removeFile}
                    onRetry={retry}
                    onDownload={downloadOne}
                  />
                ))}
              </AnimatePresence>
            </ul>
          </>
        )}

        <InspectorDialog
          entry={inspected}
          onClose={() => inspect(null)}
          onDownload={downloadOne}
        />
      </div>
    </TooltipProvider>
  );
}
