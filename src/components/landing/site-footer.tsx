import * as React from "react";
import { ShieldCheckIcon } from "lucide-react";
import { SITE, SUPPORTED_FORMATS } from "@/constants/site";

const SECTION_LINKS = [
  { href: "#cleaner", label: "Cleaner" },
  { href: "#features", label: "Features" },
  { href: "#how-it-works", label: "How it works" },
  { href: "#formats", label: "Formats" },
  { href: "#privacy", label: "Privacy" },
  { href: "#faq", label: "FAQ" },
];

const REMOVES = [
  "EXIF and maker notes",
  "GPS coordinates",
  "XMP packets",
  "IPTC records",
  "C2PA manifests",
  "AI generation data",
];

export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-surface-muted">
      <div className="mx-auto w-full max-w-6xl px-5 py-14 sm:px-8">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div className="lg:col-span-2">
            <div className="flex items-center gap-2 font-semibold tracking-tight">
              <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <ShieldCheckIcon className="size-4.5" />
              </span>
              {SITE.name}
            </div>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
              A privacy-first metadata cleaner that runs entirely in your browser. Your images are
              read locally, cleaned locally, and handed straight back to you.
            </p>
          </div>

          <nav aria-label="Footer">
            <h2 className="text-sm font-semibold">Sections</h2>
            <ul className="mt-3 flex flex-col gap-2">
              {SECTION_LINKS.map((link) => (
                <li key={link.href}>
                  <a
                    href={link.href}
                    className="rounded text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {link.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <div>
            <h2 className="text-sm font-semibold">Removes</h2>
            <ul className="mt-3 flex flex-col gap-2 text-sm text-muted-foreground">
              {REMOVES.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-10 flex flex-col gap-3 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">
            Supports {SUPPORTED_FORMATS.map((format) => format.label).join(", ")}.
          </p>
          <p className="text-xs text-muted-foreground">
            Processed on your device. Nothing is uploaded, stored or tracked.
          </p>
        </div>
      </div>
    </footer>
  );
}
