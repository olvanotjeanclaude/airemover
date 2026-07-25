import * as React from "react";
import { Cleaner } from "@/components/cleaner/cleaner";
import { Reveal } from "./reveal";

export function CleanerSection() {
  return (
    <section id="cleaner" className="scroll-mt-20 pb-8 pt-4 sm:pb-12">
      <div className="mx-auto w-full max-w-5xl px-5 sm:px-8">
        <Reveal className="mb-6 flex flex-col items-center gap-2 text-center">
          <span className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">
            Cleaner
          </span>
          <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            Clean your images
          </h2>
          <p className="max-w-xl text-pretty text-base leading-relaxed text-muted-foreground">
            Add your files, review exactly what is embedded in them, then strip it out. Everything
            below happens on this device.
          </p>
        </Reveal>

        <Cleaner />
      </div>
    </section>
  );
}
