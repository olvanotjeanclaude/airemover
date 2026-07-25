"use client";

import { create } from "zustand";
import type { ImageFormat } from "@/types/image";
import type { InspectionReport } from "@/types/metadata";
import type {
  CleanErrorCode,
  FileStatus,
  RemovedCategoryStat,
} from "@/types/processing";
import { MAX_FILES } from "@/constants/limits";

export interface CleanSummary {
  outputFormat: ImageFormat;
  outputMimeType: string;
  originalSize: number;
  cleanedSize: number;
  bytesRemoved: number;
  percentReduction: number;
  removed: RemovedCategoryStat[];
  remaining: { label: string; bytes: number; reason: string }[];
  pixelStreamPreserved: boolean;
  warnings: string[];
  verification: InspectionReport;
}

export interface FileEntry {
  id: string;
  file: File;
  name: string;
  size: number;
  status: FileStatus;
  /** 0-1 within the current stage. */
  progress: number;
  stage?: string;
  thumbnailUrl?: string;
  report?: InspectionReport;
  summary?: CleanSummary;
  /** The cleaned bytes, held as a Blob so large batches stay off the JS heap. */
  output?: Blob;
  outputName?: string;
  error?: { code: CleanErrorCode; message: string };
}

export type QueueState = "idle" | "running" | "paused";

interface FilesState {
  files: FileEntry[];
  queueState: QueueState;
  /** Id of the file whose inspector panel is open. */
  inspectedId: string | null;
  selectedIds: string[];

  addFiles: (files: File[]) => { added: number; rejected: number };
  removeFile: (id: string) => void;
  clearAll: () => void;
  clearCompleted: () => void;

  patchFile: (id: string, patch: Partial<FileEntry>) => void;
  setStatus: (id: string, status: FileStatus, stage?: string) => void;
  setProgress: (id: string, progress: number, stage?: string) => void;
  setError: (id: string, code: CleanErrorCode, message: string) => void;
  retry: (id: string) => void;
  retryAllFailed: () => void;

  setQueueState: (state: QueueState) => void;
  inspect: (id: string | null) => void;
  toggleSelected: (id: string) => void;
  selectAll: () => void;
  clearSelection: () => void;
}

let sequence = 0;

function nextId(): string {
  sequence += 1;
  return `file-${Date.now().toString(36)}-${sequence.toString(36)}`;
}

function revoke(entry: FileEntry): void {
  if (entry.thumbnailUrl) URL.revokeObjectURL(entry.thumbnailUrl);
}

export const useFilesStore = create<FilesState>()((set, get) => ({
  files: [],
  queueState: "idle",
  inspectedId: null,
  selectedIds: [],

  addFiles: (incoming) => {
    const existing = get().files;
    const room = Math.max(0, MAX_FILES - existing.length);
    const accepted = incoming.slice(0, room);

    // A file dropped twice in the same session is almost always a mistake.
    const seen = new Set(existing.map((entry) => `${entry.name}:${entry.size}`));
    const fresh: FileEntry[] = [];
    for (const file of accepted) {
      const key = `${file.name}:${file.size}`;
      if (seen.has(key)) continue;
      seen.add(key);
      fresh.push({
        id: nextId(),
        file,
        name: file.name,
        size: file.size,
        status: "pending",
        progress: 0,
      });
    }

    if (fresh.length > 0) set({ files: [...existing, ...fresh] });
    return {
      added: fresh.length,
      rejected: incoming.length - fresh.length,
    };
  },

  removeFile: (id) =>
    set((state) => {
      const target = state.files.find((entry) => entry.id === id);
      if (target) revoke(target);
      return {
        files: state.files.filter((entry) => entry.id !== id),
        inspectedId: state.inspectedId === id ? null : state.inspectedId,
        selectedIds: state.selectedIds.filter((selected) => selected !== id),
      };
    }),

  clearAll: () =>
    set((state) => {
      state.files.forEach(revoke);
      return { files: [], inspectedId: null, selectedIds: [], queueState: "idle" };
    }),

  clearCompleted: () =>
    set((state) => {
      const keep: FileEntry[] = [];
      for (const entry of state.files) {
        if (entry.status === "done") revoke(entry);
        else keep.push(entry);
      }
      return {
        files: keep,
        inspectedId: keep.some((entry) => entry.id === state.inspectedId)
          ? state.inspectedId
          : null,
      };
    }),

  patchFile: (id, patch) =>
    set((state) => ({
      files: state.files.map((entry) =>
        entry.id === id ? { ...entry, ...patch } : entry,
      ),
    })),

  setStatus: (id, status, stage) =>
    set((state) => ({
      files: state.files.map((entry) =>
        entry.id === id ? { ...entry, status, stage } : entry,
      ),
    })),

  setProgress: (id, progress, stage) =>
    set((state) => ({
      files: state.files.map((entry) =>
        entry.id === id
          ? { ...entry, progress: Math.min(1, Math.max(0, progress)), stage: stage ?? entry.stage }
          : entry,
      ),
    })),

  setError: (id, code, message) =>
    set((state) => ({
      files: state.files.map((entry) =>
        entry.id === id
          ? {
              ...entry,
              status: code === "cancelled" ? "cancelled" : "failed",
              error: { code, message },
              progress: 0,
              stage: undefined,
            }
          : entry,
      ),
    })),

  retry: (id) =>
    set((state) => ({
      files: state.files.map((entry) =>
        entry.id === id
          ? {
              ...entry,
              status: "pending",
              error: undefined,
              progress: 0,
              stage: undefined,
              output: undefined,
              summary: undefined,
            }
          : entry,
      ),
    })),

  retryAllFailed: () =>
    set((state) => ({
      files: state.files.map((entry) =>
        entry.status === "failed" || entry.status === "cancelled"
          ? {
              ...entry,
              status: "pending",
              error: undefined,
              progress: 0,
              stage: undefined,
              output: undefined,
              summary: undefined,
            }
          : entry,
      ),
    })),

  setQueueState: (queueState) => set({ queueState }),

  inspect: (inspectedId) => set({ inspectedId }),

  toggleSelected: (id) =>
    set((state) => ({
      selectedIds: state.selectedIds.includes(id)
        ? state.selectedIds.filter((selected) => selected !== id)
        : [...state.selectedIds, id],
    })),

  selectAll: () => set((state) => ({ selectedIds: state.files.map((entry) => entry.id) })),

  clearSelection: () => set({ selectedIds: [] }),
}));

export function countByStatus(files: readonly FileEntry[]): Record<FileStatus, number> {
  const counts: Record<FileStatus, number> = {
    pending: 0,
    analyzing: 0,
    queued: 0,
    processing: 0,
    done: 0,
    failed: 0,
    skipped: 0,
    cancelled: 0,
  };
  for (const entry of files) counts[entry.status] += 1;
  return counts;
}

export function overallProgress(files: readonly FileEntry[]): number {
  if (files.length === 0) return 0;
  let total = 0;
  for (const entry of files) {
    if (entry.status === "done" || entry.status === "failed" || entry.status === "cancelled") {
      total += 1;
    } else if (entry.status === "processing" || entry.status === "analyzing") {
      total += entry.progress;
    }
  }
  return total / files.length;
}

export function totalBytesRemoved(files: readonly FileEntry[]): number {
  return files.reduce((total, entry) => total + (entry.summary?.bytesRemoved ?? 0), 0);
}
