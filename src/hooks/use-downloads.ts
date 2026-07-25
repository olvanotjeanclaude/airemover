"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { createZip, downloadBlob, zipFileName } from "@/lib/download";
import { useFilesStore, type FileEntry } from "@/store/files-store";

export interface DownloadControls {
  downloadOne: (entry: FileEntry) => void;
  downloadAll: () => Promise<void>;
  isZipping: boolean;
}

export function useDownloads(): DownloadControls {
  const [isZipping, setIsZipping] = useState(false);

  const downloadOne = useCallback((entry: FileEntry) => {
    if (!entry.output) {
      toast.error("That file has not been cleaned yet.");
      return;
    }
    downloadBlob(entry.output, entry.outputName ?? entry.name);
  }, []);

  const downloadAll = useCallback(async () => {
    const ready = useFilesStore
      .getState()
      .files.filter((entry) => entry.status === "done" && entry.output);

    if (ready.length === 0) {
      toast.error("There is nothing cleaned to download yet.");
      return;
    }

    if (ready.length === 1) {
      const single = ready[0];
      downloadBlob(single.output!, single.outputName ?? single.name);
      return;
    }

    setIsZipping(true);
    try {
      const blob = await createZip(
        ready.map((entry) => ({
          name: entry.outputName ?? entry.name,
          blob: entry.output!,
        })),
      );
      downloadBlob(blob, zipFileName());
      toast.success(`Packed ${ready.length} cleaned images.`);
    } catch (error) {
      toast.error(
        error instanceof Error ? `The ZIP could not be built: ${error.message}` : "The ZIP could not be built.",
      );
    } finally {
      setIsZipping(false);
    }
  }, []);

  return { downloadOne, downloadAll, isZipping };
}
