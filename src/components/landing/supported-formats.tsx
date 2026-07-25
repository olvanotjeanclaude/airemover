import * as React from "react";
import { CheckIcon } from "lucide-react";
import { SUPPORTED_FORMATS } from "@/constants/site";
import { Badge } from "@/components/ui/badge";
import { Reveal } from "./reveal";
import { Section } from "./section";

export function SupportedFormats() {
  return (
    <Section
      id="formats"
      eyebrow="Supported formats"
      title="Six containers, each with its own parser"
      description="A generic stripper treats every file the same and re-encodes when it gets confused. Each format here has a dedicated reader and writer that understands its structure."
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {SUPPORTED_FORMATS.map((format, index) => (
          <Reveal key={format.label} delay={index * 0.05}>
            <article className="flex h-full flex-col gap-3 rounded-xl border border-border bg-card p-5 shadow-soft">
              <header className="flex items-center justify-between gap-3">
                <h3 className="text-lg font-semibold tracking-tight">{format.label}</h3>
                {format.lossless ? (
                  <Badge variant="success">
                    <CheckIcon />
                    Lossless
                  </Badge>
                ) : null}
              </header>
              <p className="text-sm leading-relaxed text-muted-foreground">{format.note}</p>
              <div className="mt-auto flex flex-wrap gap-1.5 pt-2">
                {format.extensions.map((extension) => (
                  <span
                    key={extension}
                    className="rounded-md bg-surface-sunken px-2 py-0.5 font-mono text-xs text-muted-foreground"
                  >
                    {extension}
                  </span>
                ))}
              </div>
            </article>
          </Reveal>
        ))}
      </div>

      <Reveal delay={0.12} className="mt-8">
        <p className="mx-auto max-w-2xl text-center text-sm leading-relaxed text-muted-foreground">
          HEIC previews depend on your browser having a HEIF decoder, which today means Safari.
          The metadata itself is read and removed on every browser, because that work is done by
          this app rather than by the platform.
        </p>
      </Reveal>
    </Section>
  );
}
