import type { Metadata } from "next";
import { SITE, SUPPORTED_FORMATS } from "@/constants/site";
import { CleanerSection } from "@/components/landing/cleaner-section";
import { FAQ_ITEMS, Faq } from "@/components/landing/faq";
import { Features } from "@/components/landing/features";
import { Hero } from "@/components/landing/hero";
import { HowItWorks } from "@/components/landing/how-it-works";
import { Privacy } from "@/components/landing/privacy";
import { SiteFooter } from "@/components/landing/site-footer";
import { SiteHeader } from "@/components/landing/site-header";
import { SupportedFormats } from "@/components/landing/supported-formats";

export const metadata: Metadata = {
  title: `${SITE.tagline} — EXIF, GPS, AI and C2PA`,
  description: SITE.description,
};

/**
 * Structured data is built from the same constants the page renders, so the
 * markup and the machine-readable description cannot drift apart.
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
      "AI generation metadata parsing for Stable Diffusion, ComfyUI, Midjourney and more",
      "Batch processing of up to 500 images",
      "Fully client-side processing with no uploads",
    ],
    isAccessibleForFree: true,
    softwareHelp: `${SITE.url}#faq`,
  };

  const faq = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ_ITEMS.map((item) => ({
      "@type": "Question",
      name: item.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.answer,
      },
    })),
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

  return JSON.stringify([application, faq, howTo]);
}

export default function HomePage() {
  return (
    <>
      <script
        type="application/ld+json"
        // Generated from local constants, never from user input.
        dangerouslySetInnerHTML={{ __html: structuredData() }}
      />
      <SiteHeader />
      <main className="flex-1">
        <Hero />
        <CleanerSection />
        <Features />
        <HowItWorks />
        <SupportedFormats />
        <Privacy />
        <Faq />
      </main>
      <SiteFooter />
    </>
  );
}
