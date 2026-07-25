import * as React from "react";
import { Reveal } from "./reveal";
import { Section } from "./section";

const STEPS = [
  {
    title: "Load your images",
    body: "Drop, paste or browse. The file is read with the FileReader API into an ArrayBuffer that never leaves the tab.",
  },
  {
    title: "The container is parsed",
    body: "A worker walks the actual binary structure: JPEG markers, PNG chunks, RIFF chunks, ISOBMFF boxes or TIFF directories. Nothing is guessed from the file extension.",
  },
  {
    title: "Metadata is identified",
    body: "EXIF directories, XMP packets, IPTC records, ICC profiles, JUMBF manifests and generator blocks are decoded and shown to you with their byte offsets.",
  },
  {
    title: "The file is rebuilt",
    body: "Selected blocks are dropped and the container is written back out. Checksums are recalculated, chunk sizes updated, and item offset tables repaired.",
  },
  {
    title: "The result is verified",
    body: "The output is parsed a second time and the report is generated from the cleaned bytes, so what you see is what the file actually contains.",
  },
  {
    title: "You download it",
    body: "One file, or the whole batch as a ZIP. The download comes straight from browser memory.",
  },
];

export function HowItWorks() {
  return (
    <Section
      id="how-it-works"
      eyebrow="How it works"
      title="Six steps, none of which involve a server"
      description="The entire pipeline is JavaScript running in a Web Worker on your machine. Turn off your network connection after the page loads and it still works."
    >
      <ol className="relative grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {STEPS.map((step, index) => (
          <Reveal key={step.title} delay={index * 0.05}>
            <li className="relative flex h-full flex-col gap-2 rounded-xl border border-border bg-card p-5 shadow-soft">
              <span className="tabular text-sm font-semibold text-primary">
                {String(index + 1).padStart(2, "0")}
              </span>
              <h3 className="text-base font-semibold tracking-tight">{step.title}</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">{step.body}</p>
            </li>
          </Reveal>
        ))}
      </ol>
    </Section>
  );
}
