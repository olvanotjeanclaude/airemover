"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { RemovableCategory, RemovalOptions } from "@/types/metadata";
import type {
  ProcessingMode,
  ProcessingSettings,
  RebuildOptions,
} from "@/types/processing";
import { DEFAULT_REBUILD, DEFAULT_REMOVAL, createDefaultSettings } from "@/constants/defaults";
import { MAX_CONCURRENCY, MIN_CONCURRENCY } from "@/constants/limits";

interface SettingsState extends ProcessingSettings {
  setMode: (mode: ProcessingMode) => void;
  toggleCategory: (category: RemovableCategory, value?: boolean) => void;
  setRemoval: (removal: RemovalOptions) => void;
  setRebuild: (patch: Partial<RebuildOptions>) => void;
  setFilenameSuffix: (suffix: string) => void;
  setConcurrency: (value: number) => void;
  resetToDefaults: () => void;
  snapshot: () => ProcessingSettings;
}

/**
 * Settings live in `localStorage` only. Nothing here is ever transmitted; the
 * store exists so a returning user keeps their switches, not for analytics.
 */
export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      ...createDefaultSettings(),

      setMode: (mode) => set({ mode }),

      toggleCategory: (category, value) =>
        set((state) => ({
          removal: {
            ...state.removal,
            [category]: value ?? !state.removal[category],
          },
        })),

      setRemoval: (removal) => set({ removal }),

      setRebuild: (patch) =>
        set((state) => ({ rebuild: { ...state.rebuild, ...patch } })),

      setFilenameSuffix: (suffix) =>
        set({ filenameSuffix: suffix.replace(/[\\/:*?"<>|]/g, "").slice(0, 24) }),

      setConcurrency: (value) =>
        set({
          concurrency: Math.min(MAX_CONCURRENCY, Math.max(MIN_CONCURRENCY, Math.round(value))),
        }),

      resetToDefaults: () => set({ ...createDefaultSettings() }),

      snapshot: () => {
        const state = get();
        return {
          mode: state.mode,
          removal: { ...state.removal },
          rebuild: { ...state.rebuild },
          filenameSuffix: state.filenameSuffix,
          concurrency: state.concurrency,
        };
      },
    }),
    {
      name: "image-metadata-cleaner:settings",
      version: 1,
      partialize: (state) => ({
        mode: state.mode,
        removal: state.removal,
        rebuild: state.rebuild,
        filenameSuffix: state.filenameSuffix,
        concurrency: state.concurrency,
      }),
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<ProcessingSettings>;
        return {
          ...current,
          ...saved,
          // A stored payload from an older version may miss newer switches.
          removal: { ...DEFAULT_REMOVAL, ...(saved.removal ?? {}) },
          rebuild: { ...DEFAULT_REBUILD, ...(saved.rebuild ?? {}) },
        };
      },
    },
  ),
);
