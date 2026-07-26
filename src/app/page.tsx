import type { Metadata } from "next";
import { ShieldCheckIcon } from "lucide-react";
import { AI_GENERATORS, SITE, SUPPORTED_FORMATS } from "@/constants/site";
import { Cleaner } from "@/components/cleaner/cleaner";
import { ThemeToggle } from "@/components/theme/theme-toggle";

export const metadata: Metadata = {
  title: `${SITE.tagline} — EXIF, GPS, AI and C2PA`,
  description: SITE.description,
};

/**
 * The page itself is just the tool, so the machine-readable description is what
 * search engines have to work from. It is built from the same constants the app
 * uses, so the two cannot drift apart.
 */
function structuredData(): string {
  const application = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: SITE.name,
    url: SITE.url,
    description: SITE.description,
    applicationCategory: "UtilitiesApplication",
    operatingSystem: "Any browser",
    browserRequirements: "Requires JavaScript and a modern browser",
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
    },
    featureList: [
      "Lossless EXIF removal without re-encoding",
      "GPS location stripping from inside EXIF",
      "XMP, IPTC and Photoshop resource removal",
      "C2PA Content Credentials detection and removal",
      `AI generation metadata parsing for ${AI_GENERATORS.join(", ")}`,
      `Supports ${SUPPORTED_FORMATS.map((format) => format.label).join(", ")}`,
      "Batch processing of up to 500 images",
      "Fully client-side processing with no uploads",
    ],
    isAccessibleForFree: true,
  };

  const howTo = {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: "How to remove metadata from an image",
    description: SITE.description,
    totalTime: "PT1M",
    supply: SUPPORTED_FORMATS.map((format) => ({
      "@type": "HowToSupply",
      name: `${format.label} image`,
    })),
    step: [
      {
        "@type": "HowToStep",
        name: "Add your images",
        text: "Drop, paste or browse for the images you want to clean. They are read locally and never uploaded.",
      },
      {
        "@type": "HowToStep",
        name: "Review what is embedded",
        text: "Open the inspector to see the EXIF, GPS, XMP, IPTC, C2PA and AI generation data found in each file.",
      },
      {
        "@type": "HowToStep",
        name: "Clean and download",
        text: "Start the queue, then download the cleaned files individually or as a ZIP archive.",
      },
    ],
  };

  return JSON.stringify([application, howTo]);
}

export default function HomePage() {
  return (
    <>
      <script
        type="application/ld+json"
        // Generated from local constants, never from user input.
        dangerouslySetInnerHTML={{ __html: structuredData() }}
      />
      <main
        id="cleaner"
        className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-4 px-4 py-4 sm:px-6 sm:py-6"
      >
        <header className="flex items-center gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <ShieldCheckIcon className="size-4.5" />
          </span>
          <h1 className="text-base font-semibold tracking-tight">{SITE.shortName}</h1>
          <p className="hidden text-sm text-muted-foreground sm:block">
            Drop, paste or browse images. Everything is processed on this device.
          </p>
          <div className="ml-auto">
            <ThemeToggle />
          </div>
        </header>

        <Cleaner />
      </main>
    </>
  );
}
