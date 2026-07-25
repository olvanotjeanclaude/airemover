import * as React from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Reveal } from "./reveal";
import { Section } from "./section";

export const FAQ_ITEMS = [
  {
    question: "Does cleaning reduce my image quality?",
    answer:
      "Not in lossless mode, which is the default. The compressed image stream is copied byte for byte into the new file, so the decoded pixels are identical to the original. Only the metadata blocks are dropped, which is why the file gets smaller. Rebuild mode does re-encode, and it says so.",
  },
  {
    question: "Are my images really not uploaded?",
    answer:
      "There is no server component to upload to. Files are read locally, processed in a Web Worker, and returned as a download. The Content Security Policy restricts network connections to this origin, and the app keeps working with your network disconnected, which you can test yourself.",
  },
  {
    question: "What exactly is removed?",
    answer:
      "By default: EXIF including camera identity, serial numbers and timestamps; GPS coordinates; XMP packets; IPTC and Photoshop records; C2PA Content Credentials; AI generation data; free-text comments; and unrecognised vendor blocks. The ICC colour profile is kept by default because removing it visibly changes colours. Every one of these is an independent switch.",
  },
  {
    question: "Can it read the prompt out of an AI-generated image?",
    answer:
      "Yes, when the generator embedded one. Automatic1111, ComfyUI, Fooocus, InvokeAI, NovelAI, SwarmUI and Midjourney each store parameters differently, and each has a dedicated parser. ComfyUI graphs are walked node by node to tell the positive prompt from the negative one. Firefly, DALL-E and Imagen do not embed prompts; they embed signed provenance, which is detected instead.",
  },
  {
    question: "Why keep the ICC colour profile?",
    answer:
      "Because it is not really metadata about you, it is information the viewer needs to render colours correctly. Removing it from a wide-gamut image makes it look washed out or oversaturated depending on the display. If you want it gone anyway, the switch is there.",
  },
  {
    question: "Will removing EXIF rotate my photos?",
    answer:
      "It can. Orientation lives in EXIF, so stripping EXIF removes the flag telling viewers to rotate the image. Most modern software writes correctly-oriented pixels anyway, but if a photo appears sideways after cleaning, rebuild mode bakes the rotation into the pixels before re-encoding.",
  },
  {
    question: "What is C2PA, and why would I remove it?",
    answer:
      "C2PA Content Credentials are cryptographically signed records of how an image was made and edited, embedded by tools like Adobe Firefly and Photoshop. They can identify your software, your account and your editing history. Removing them is a legitimate privacy choice, but be aware it also removes a provenance signal others may rely on to judge whether an image is authentic.",
  },
  {
    question: "How many files can I process at once?",
    answer:
      "Up to 500 per batch, with individual files up to 256 MB. Work is spread across a pool of Web Workers so the interface stays responsive, and the queue can be paused, resumed or cancelled at any point.",
  },
  {
    question: "Why is my cleaned file only slightly smaller?",
    answer:
      "Because metadata is usually a small fraction of an image. A photo with a large EXIF block, an embedded thumbnail and a C2PA manifest can lose tens of kilobytes, while a screenshot with a single text chunk loses a few hundred bytes. The file size drops by exactly the amount of metadata removed, which is the point of a lossless clean.",
  },
  {
    question: "Does it cost anything, or need an account?",
    answer:
      "No. There is no account, no email, no limit and no payment. There is also no server bill to pay, because the work happens on your computer.",
  },
];

export function Faq() {
  return (
    <Section
      id="faq"
      eyebrow="FAQ"
      title="Questions worth asking"
      description="Especially the ones about whether a privacy tool can be trusted."
      centered
    >
      <Reveal>
        <div className="mx-auto max-w-3xl rounded-xl border border-border bg-card px-6 shadow-soft">
          <Accordion type="single" collapsible>
            {FAQ_ITEMS.map((item, index) => (
              <AccordionItem key={item.question} value={`item-${index}`}>
                <AccordionTrigger>{item.question}</AccordionTrigger>
                <AccordionContent>{item.answer}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </Reveal>
    </Section>
  );
}
