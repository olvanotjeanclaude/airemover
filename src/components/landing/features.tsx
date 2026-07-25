import * as React from "react";
import {
  BrainCircuitIcon,
  FileSearchIcon,
  LayersIcon,
  MapPinOffIcon,
  ScissorsIcon,
  ShieldCheckIcon,
  SlidersHorizontalIcon,
  ZapIcon,
} from "lucide-react";
import { AI_GENERATORS } from "@/constants/site";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Reveal } from "./reveal";
import { Section } from "./section";

const FEATURES = [
  {
    Icon: ScissorsIcon,
    title: "Truly lossless by default",
    description:
      "The binary container is parsed, metadata segments are dropped, and the compressed image stream is copied across untouched. Same dimensions, same quality, same compression, smaller file.",
  },
  {
    Icon: BrainCircuitIcon,
    title: "Reads AI generation data",
    description:
      "Prompts, negative prompts, seeds, samplers, schedulers, checkpoints, LoRAs, ControlNets and full ComfyUI node graphs are parsed and shown before anything is removed.",
  },
  {
    Icon: MapPinOffIcon,
    title: "Surgical GPS removal",
    description:
      "Location can be stripped from inside EXIF while the camera settings you actually want stay. The IFD tree is rebuilt from scratch with corrected offsets.",
  },
  {
    Icon: ShieldCheckIcon,
    title: "C2PA Content Credentials",
    description:
      "JUMBF manifest stores are located in JPEG APP11, PNG caBX chunks, WebP C2PA chunks and BMFF uuid boxes, then reported assertion by assertion.",
  },
  {
    Icon: FileSearchIcon,
    title: "An inspector, not a black box",
    description:
      "Every metadata block is listed with its container, byte offset and size. After cleaning, the output file is re-parsed so you can verify what actually left.",
  },
  {
    Icon: SlidersHorizontalIcon,
    title: "Choose exactly what goes",
    description:
      "Nine independent switches: EXIF, GPS, XMP, IPTC, ICC, C2PA, AI data, comments and unknown vendor blocks. The colour profile is kept by default so colours do not shift.",
  },
  {
    Icon: LayersIcon,
    title: "Batches of 500",
    description:
      "A worker pool keeps the interface responsive while the queue runs. Pause, resume, cancel and retry individual files, then download everything as a ZIP.",
  },
  {
    Icon: ZapIcon,
    title: "Nothing to trust",
    description:
      "There is no server to send images to. The Content Security Policy blocks outbound connections entirely, so the privacy claim is enforced by the browser, not by a promise.",
  },
];

export function Features() {
  return (
    <Section
      id="features"
      eyebrow="Features"
      title="Built like a forensics tool, not an upload form"
      description="Most online strippers re-encode your photo and hand it back smaller and softer. This one edits the container and leaves the pixels alone."
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {FEATURES.map((feature, index) => (
          <Reveal key={feature.title} delay={index * 0.04}>
            <Card className="h-full transition-shadow hover:shadow-lift">
              <CardHeader>
                <span className="mb-1 flex size-10 items-center justify-center rounded-lg bg-primary/12 text-primary">
                  <feature.Icon className="size-5" />
                </span>
                <CardTitle>{feature.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription className="leading-relaxed">
                  {feature.description}
                </CardDescription>
              </CardContent>
            </Card>
          </Reveal>
        ))}
      </div>

      <Reveal delay={0.1} className="mt-10">
        <div className="rounded-xl border border-border bg-surface-muted p-6">
          <h3 className="text-sm font-semibold">Generators recognised by name</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Each one writes its parameters differently, so each gets its own parser rather than a
            keyword search.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {AI_GENERATORS.map((generator) => (
              <Badge key={generator} variant="outline">
                {generator}
              </Badge>
            ))}
          </div>
        </div>
      </Reveal>
    </Section>
  );
}
