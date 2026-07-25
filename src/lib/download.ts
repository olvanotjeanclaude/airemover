import { zip, type Zippable } from "fflate";

/** Triggers a browser download and releases the object URL afterwards. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoking synchronously can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export interface ZipEntry {
  name: string;
  blob: Blob;
}

/**
 * Packs the cleaned files into a ZIP with compression disabled.
 *
 * Every entry is already a compressed image, so deflating again costs seconds
 * of main-thread time for a fraction of a percent. Storing keeps a 500-file
 * batch responsive.
 */
export async function createZip(entries: readonly ZipEntry[]): Promise<Blob> {
  const payload: Zippable = {};
  const used = new Set<string>();

  for (const entry of entries) {
    let name = entry.name;
    if (used.has(name)) {
      const dot = name.lastIndexOf(".");
      const stem = dot > 0 ? name.slice(0, dot) : name;
      const extension = dot > 0 ? name.slice(dot) : "";
      let counter = 2;
      while (used.has(`${stem} (${counter})${extension}`)) counter += 1;
      name = `${stem} (${counter})${extension}`;
    }
    used.add(name);
    payload[name] = [new Uint8Array(await entry.blob.arrayBuffer()), { level: 0 }];
  }

  return new Promise<Blob>((resolve, reject) => {
    zip(payload, { level: 0 }, (error, data) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(new Blob([data as BlobPart], { type: "application/zip" }));
    });
  });
}

export function zipFileName(): string {
  const stamp = new Date().toISOString().slice(0, 10);
  return `cleaned-images-${stamp}.zip`;
}
