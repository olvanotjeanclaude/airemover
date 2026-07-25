"use client";

import { useCallback, useEffect, useRef } from "react";
import type { ProcessingSettings } from "@/types/processing";
import type { CleanRequest, WorkerResponse } from "@/types/worker";
import { CleanError } from "@/types/processing";
import { MAX_FILE_BYTES } from "@/constants/limits";
import { WorkerPool } from "@/lib/worker/pool";
import { createThumbnail, decodeForRebuild } from "@/lib/image/thumbnail";
import { extensionFor } from "@/lib/image/utils/format";
import { cleanedFileName } from "@/lib/image/utils/size";
import { useFilesStore, type FileEntry } from "@/store/files-store";
import { useSettingsStore } from "@/store/settings-store";

/** Analysis is cheap and read-only, so it runs at a fixed low concurrency. */
const ANALYSIS_CONCURRENCY = 2;

export interface QueueControls {
  start: () => void;
  pause: () => void;
  resume: () => void;
  cancel: () => void;
  retryFailed: () => void;
}

/**
 * Drives both pipelines: every new file is inspected as soon as it lands, and
 * cleaning runs only once the user starts the queue. Both share one worker
 * pool, and a generation counter makes results from a cancelled run harmless.
 */
export function useProcessingQueue(): QueueControls {
  const poolRef = useRef<WorkerPool | null>(null);
  const generationRef = useRef(0);
  const activeCleanRef = useRef(0);
  const activeAnalysisRef = useRef(0);
  const inFlightRef = useRef(new Set<string>());

  const getPool = useCallback((): WorkerPool => {
    if (!poolRef.current) {
      poolRef.current = new WorkerPool(useSettingsStore.getState().concurrency);
    }
    return poolRef.current;
  }, []);

  useEffect(() => {
    return () => {
      poolRef.current?.dispose();
      poolRef.current = null;
    };
  }, []);

  const analyzeOne = useCallback(
    async (entry: FileEntry): Promise<void> => {
      const store = useFilesStore.getState();
      store.setStatus(entry.id, "analyzing", "Reading metadata");

      try {
        if (entry.size > MAX_FILE_BYTES) {
          throw new CleanError(
            "too-large",
            `This file is larger than the ${Math.round(MAX_FILE_BYTES / (1024 * 1024))} MB limit.`,
          );
        }

        const [buffer, thumbnailUrl] = await Promise.all([
          entry.file.arrayBuffer(),
          createThumbnail(entry.file),
        ]);

        const response = await getPool().run(
          {
            kind: "analyze",
            jobId: entry.id,
            fileName: entry.name,
            buffer,
          },
          [buffer],
        );

        if (response.kind === "error") {
          if (thumbnailUrl) URL.revokeObjectURL(thumbnailUrl);
          useFilesStore.getState().setError(entry.id, response.code, response.message);
          return;
        }
        if (response.kind !== "analyze:done") return;

        useFilesStore.getState().patchFile(entry.id, {
          report: response.report,
          thumbnailUrl: thumbnailUrl ?? undefined,
          status: "pending",
          stage: undefined,
          progress: 0,
        });
      } catch (error) {
        const code = error instanceof CleanError ? error.code : "unknown";
        useFilesStore
          .getState()
          .setError(
            entry.id,
            code,
            error instanceof Error ? error.message : "The file could not be read.",
          );
      }
    },
    [getPool],
  );

  const cleanOne = useCallback(
    async (entry: FileEntry, settings: ProcessingSettings, generation: number): Promise<void> => {
      const store = useFilesStore.getState();
      store.setStatus(entry.id, "processing", "Preparing");
      store.setProgress(entry.id, 0.05, "Preparing");

      try {
        const buffer = await entry.file.arrayBuffer();
        const transfer: Transferable[] = [buffer];

        let bitmap: ImageBitmap | undefined;
        if (settings.mode === "rebuild") {
          const decoded = await decodeForRebuild(entry.file);
          if (!decoded) {
            throw new CleanError(
              "decode-failed",
              "This browser cannot decode the image, so it cannot be rebuilt. Use lossless mode.",
            );
          }
          bitmap = decoded;
          transfer.push(decoded);
        }

        const request: CleanRequest = {
          kind: "clean",
          jobId: entry.id,
          fileName: entry.name,
          buffer,
          settings,
          bitmap,
        };

        const response: WorkerResponse = await getPool().run(request, transfer, (value, stage) => {
          if (generationRef.current !== generation) return;
          useFilesStore.getState().setProgress(entry.id, value, stage);
        });

        if (generationRef.current !== generation) return;

        if (response.kind === "error") {
          useFilesStore.getState().setError(entry.id, response.code, response.message);
          return;
        }
        if (response.kind !== "clean:done") return;

        const blob = new Blob([response.buffer], { type: response.outputMimeType });
        useFilesStore.getState().patchFile(entry.id, {
          status: "done",
          progress: 1,
          stage: undefined,
          output: blob,
          outputName: cleanedFileName(
            entry.name,
            extensionFor(response.outputFormat),
            settings.filenameSuffix,
          ),
          summary: {
            outputFormat: response.outputFormat,
            outputMimeType: response.outputMimeType,
            originalSize: response.originalSize,
            cleanedSize: response.cleanedSize,
            bytesRemoved: response.bytesRemoved,
            percentReduction: response.percentReduction,
            removed: response.removed,
            remaining: response.remaining,
            pixelStreamPreserved: response.pixelStreamPreserved,
            warnings: response.warnings,
            verification: response.verification,
          },
          error: undefined,
        });
      } catch (error) {
        if (generationRef.current !== generation) return;
        const code = error instanceof CleanError ? error.code : "unknown";
        useFilesStore
          .getState()
          .setError(
            entry.id,
            code,
            error instanceof Error ? error.message : "The file could not be processed.",
          );
      }
    },
    [getPool],
  );

  /**
   * The scheduler re-enters itself whenever a job settles. Routing that through
   * a ref keeps the recursion honest: the callback never closes over a version
   * of itself that was declared later in the same render.
   */
  const pumpRef = useRef<() => void>(() => {});
  const schedulePump = useCallback((): void => {
    pumpRef.current();
  }, []);

  const pump = useCallback((): void => {
    // Analysis pipeline: always on, independent of the queue's run state.
    while (activeAnalysisRef.current < ANALYSIS_CONCURRENCY) {
      const next = useFilesStore
        .getState()
        .files.find(
          (entry) =>
            entry.status === "pending" &&
            !entry.report &&
            !entry.error &&
            !inFlightRef.current.has(entry.id),
        );
      if (!next) break;
      inFlightRef.current.add(next.id);
      activeAnalysisRef.current += 1;
      void analyzeOne(next).finally(() => {
        activeAnalysisRef.current -= 1;
        inFlightRef.current.delete(next.id);
        schedulePump();
      });
    }

    if (useFilesStore.getState().queueState !== "running") return;

    const settings = useSettingsStore.getState().snapshot();
    const generation = generationRef.current;

    while (activeCleanRef.current < settings.concurrency) {
      const next = useFilesStore
        .getState()
        .files.find(
          (entry) =>
            entry.status === "pending" &&
            Boolean(entry.report) &&
            !inFlightRef.current.has(entry.id),
        );
      if (!next) break;
      inFlightRef.current.add(next.id);
      activeCleanRef.current += 1;
      void cleanOne(next, settings, generation).finally(() => {
        activeCleanRef.current -= 1;
        inFlightRef.current.delete(next.id);
        schedulePump();
      });
    }

    if (activeCleanRef.current > 0 || activeAnalysisRef.current > 0) return;
    const store = useFilesStore.getState();
    const hasWork = store.files.some(
      (entry) => entry.status === "pending" || entry.status === "analyzing",
    );
    if (!hasWork && store.queueState === "running") {
      store.setQueueState("idle");
    }
  }, [analyzeOne, cleanOne, schedulePump]);

  // React to files being added, analysed, or the queue being started.
  useEffect(() => {
    pumpRef.current = pump;
    pump();
    return useFilesStore.subscribe(() => pump());
  }, [pump]);

  // The pool is sized once per concurrency setting; changing it rebuilds it.
  useEffect(() => {
    return useSettingsStore.subscribe((state, previous) => {
      if (state.concurrency === previous.concurrency) return;
      if (useFilesStore.getState().queueState === "running") return;
      poolRef.current?.dispose();
      poolRef.current = null;
    });
  }, []);

  const start = useCallback(() => {
    generationRef.current += 1;
    useFilesStore.getState().setQueueState("running");
    pump();
  }, [pump]);

  const pause = useCallback(() => {
    useFilesStore.getState().setQueueState("paused");
    poolRef.current?.clearQueue();
  }, []);

  const resume = useCallback(() => {
    useFilesStore.getState().setQueueState("running");
    pump();
  }, [pump]);

  const cancel = useCallback(() => {
    generationRef.current += 1;
    const store = useFilesStore.getState();
    store.setQueueState("idle");
    poolRef.current?.clearQueue();
    for (const entry of store.files) {
      if (entry.status === "processing") {
        store.patchFile(entry.id, {
          status: "cancelled",
          progress: 0,
          stage: undefined,
          error: { code: "cancelled", message: "Cancelled before it finished." },
        });
      }
    }
    inFlightRef.current.clear();
    activeCleanRef.current = 0;
  }, []);

  const retryFailed = useCallback(() => {
    useFilesStore.getState().retryAllFailed();
    pump();
  }, [pump]);

  return { start, pause, resume, cancel, retryFailed };
}
