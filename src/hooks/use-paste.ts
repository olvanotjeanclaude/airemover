"use client";

import { useEffect } from "react";

/**
 * Accepts images pasted anywhere on the page, unless focus is inside a field
 * where the user is plainly trying to paste text.
 */
export function usePasteImages(onFiles: (files: File[]) => void): void {
  useEffect(() => {
    const handlePaste = (event: ClipboardEvent): void => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;

      const items = event.clipboardData?.items;
      if (!items) return;

      const files: File[] = [];
      for (const item of items) {
        if (item.kind !== "file") continue;
        const file = item.getAsFile();
        if (!file) continue;
        if (file.type && !file.type.startsWith("image/")) continue;
        // Clipboard images arrive named "image.png"; give them a unique name.
        const stamped =
          file.name && file.name !== "image.png"
            ? file
            : new File([file], `pasted-${files.length + 1}-${Date.now()}.png`, {
                type: file.type || "image/png",
              });
        files.push(stamped);
      }

      if (files.length > 0) {
        event.preventDefault();
        onFiles(files);
      }
    };

    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [onFiles]);
}
