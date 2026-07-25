"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { useDropzone, type Accept, type FileRejection } from "react-dropzone";
import { toast } from "sonner";
import { ImageUpIcon, LockIcon, ShieldCheckIcon, WifiOffIcon } from "lucide-react";
import { MAX_FILES } from "@/constants/limits";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const ACCEPT: Accept = {
  "image/jpeg": [".jpg", ".jpeg", ".jpe", ".jfif"],
  "image/png": [".png", ".apng"],
  "image/webp": [".webp"],
  "image/avif": [".avif", ".avifs"],
  "image/heic": [".heic"],
  "image/heif": [".heif"],
  "image/tiff": [".tif", ".tiff"],
};

export interface UploadZoneProps {
  onFiles: (files: File[]) => void;
  /** Compact form is used once the queue already has files. */
  compact?: boolean;
  remainingSlots: number;
}

export function UploadZone({ onFiles, compact = false, remainingSlots }: UploadZoneProps) {
  const handleDrop = React.useCallback(
    (accepted: File[], rejected: FileRejection[]) => {
      if (rejected.length > 0) {
        const names = rejected.slice(0, 3).map((entry) => entry.file.name);
        toast.error(
          rejected.length === 1
            ? `${names[0]} is not a supported image format.`
            : `${rejected.length} files were skipped because their format is not supported.`,
        );
      }
      if (accepted.length > 0) onFiles(accepted);
    },
    [onFiles],
  );

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    accept: ACCEPT,
    onDrop: handleDrop,
    noClick: true,
    noKeyboard: true,
    maxFiles: Math.max(1, remainingSlots),
    multiple: true,
  });

  const isFull = remainingSlots <= 0;

  if (compact) {
    return (
      <div
        {...getRootProps()}
        className={cn(
          "flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed px-4 py-3 transition-colors",
          isDragActive ? "border-primary bg-primary/6" : "border-border bg-surface-muted",
        )}
      >
        <input {...getInputProps()} aria-label="Add more images" />
        <p className="text-sm text-muted-foreground">
          {isFull
            ? `The queue is full at ${MAX_FILES} images.`
            : `Drop, paste, or browse to add up to ${remainingSlots} more.`}
        </p>
        <Button variant="outline" size="sm" onClick={open} disabled={isFull}>
          <ImageUpIcon />
          Add images
        </Button>
      </div>
    );
  }

  return (
    <div
      {...getRootProps()}
      className={cn(
        "group relative overflow-hidden rounded-2xl border-2 border-dashed transition-colors duration-200",
        isDragActive
          ? "border-primary bg-primary/6"
          : "border-border bg-surface-muted hover:border-primary/45",
      )}
    >
      <input {...getInputProps()} aria-label="Choose images to clean" />

      <motion.div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-60"
        animate={{ opacity: isDragActive ? 0.9 : 0.5 }}
        transition={{ duration: 0.25 }}
        style={{
          background:
            "radial-gradient(60% 60% at 50% 0%, color-mix(in oklab, var(--primary) 14%, transparent), transparent 70%)",
        }}
      />

      <div className="relative flex flex-col items-center gap-6 px-6 py-14 text-center sm:py-20">
        <motion.div
          animate={{ scale: isDragActive ? 1.06 : 1, y: isDragActive ? -3 : 0 }}
          transition={{ type: "spring", stiffness: 320, damping: 22 }}
          className="flex size-16 items-center justify-center rounded-2xl border border-border bg-surface shadow-soft"
        >
          <ImageUpIcon className="size-7 text-primary" />
        </motion.div>

        <div className="max-w-lg space-y-2">
          <h3 className="text-xl font-semibold tracking-tight sm:text-2xl">
            {isDragActive ? "Drop to load them" : "Drop images here"}
          </h3>
          <p className="text-sm leading-relaxed text-muted-foreground">
            JPEG, PNG, WebP, AVIF, HEIC and TIFF. Up to {MAX_FILES} at a time. Paste from the
            clipboard with <kbd className="rounded border border-border bg-surface px-1.5 py-0.5 text-xs">Ctrl</kbd>
            {" + "}
            <kbd className="rounded border border-border bg-surface px-1.5 py-0.5 text-xs">V</kbd>.
          </p>
        </div>

        <Button size="lg" onClick={open} disabled={isFull}>
          Browse images
        </Button>

        <ul className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
          <li className="flex items-center gap-1.5">
            <WifiOffIcon className="size-3.5" />
            Nothing is uploaded
          </li>
          <li className="flex items-center gap-1.5">
            <ShieldCheckIcon className="size-3.5" />
            No tracking or analytics
          </li>
          <li className="flex items-center gap-1.5">
            <LockIcon className="size-3.5" />
            Runs offline once loaded
          </li>
        </ul>
      </div>
    </div>
  );
}
