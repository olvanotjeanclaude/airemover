import * as React from "react";
import { CheckIcon, XIcon } from "lucide-react";
import { Reveal } from "./reveal";
import { Section } from "./section";

const GUARANTEES = [
  {
    title: "Your images are never uploaded",
    body: "There is no upload endpoint. Files are read into memory with the FileReader API, processed in a Web Worker, and handed back as a Blob.",
  },
  {
    title: "Outbound requests are blocked",
    body: "The Content Security Policy sets connect-src to 'self' and form-action to 'none'. Even if the code tried to send your image somewhere, the browser would refuse.",
  },
  {
    title: "No analytics, no telemetry, no cookies",
    body: "No third-party scripts, no pixel, no fingerprinting, no session. The only thing stored is your switch preferences, in this browser's local storage.",
  },
  {
    title: "It works offline",
    body: "Load the page once, disconnect, and everything still runs. That is the simplest proof that nothing is being sent anywhere.",
  },
];

const NEVER = [
  "Uploading your files to a server",
  "Sending prompts or GPS coordinates anywhere",
  "Storing your images after the tab closes",
  "Requiring an account or an email address",
  "Watermarking or degrading the output",
  "Limiting how many files you can clean",
];

export function Privacy() {
  return (
    <Section
      id="privacy"
      eyebrow="Privacy"
      title="Private by architecture, not by policy"
      description="A privacy policy is a promise. Doing the work on your own machine is a guarantee, and it is one you can verify with your browser's network tab."
    >
      <div className="grid gap-8 lg:grid-cols-2">
        <Reveal className="flex flex-col gap-4">
          {GUARANTEES.map((item) => (
            <div
              key={item.title}
              className="flex gap-4 rounded-xl border border-border bg-card p-5 shadow-soft"
            >
              <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-success/15 text-success">
                <CheckIcon className="size-4" strokeWidth={3} />
              </span>
              <div>
                <h3 className="text-sm font-semibold">{item.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{item.body}</p>
              </div>
            </div>
          ))}
        </Reveal>

        <Reveal delay={0.08}>
          <div className="h-full rounded-xl border border-border bg-surface-muted p-6">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              What this app never does
            </h3>
            <ul className="mt-4 flex flex-col gap-3">
              {NEVER.map((item) => (
                <li key={item} className="flex items-center gap-3 text-sm">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-destructive/12 text-destructive">
                    <XIcon className="size-3.5" strokeWidth={3} />
                  </span>
                  {item}
                </li>
              ))}
            </ul>

            <div className="mt-6 rounded-lg border border-border bg-surface p-4">
              <p className="text-sm leading-relaxed text-muted-foreground">
                Metadata removal protects the person sharing an image. It does not make an image
                untraceable, and it does not change what is visible in the picture itself. If an
                image is sensitive, judge it on what it shows, not only on what is embedded in it.
              </p>
            </div>
          </div>
        </Reveal>
      </div>
    </Section>
  );
}
