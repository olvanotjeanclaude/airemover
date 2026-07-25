import type { MetadataRoute } from "next";
import { SITE } from "@/constants/site";

/**
 * A single-page app, but the in-page sections are the things people link to and
 * search engines surface, so they are listed as anchors of the same document.
 */
const SECTIONS = ["", "#cleaner", "#features", "#how-it-works", "#formats", "#privacy", "#faq"];

export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return SECTIONS.map((section, index) => ({
    url: `${SITE.url}/${section}`,
    lastModified,
    changeFrequency: "monthly",
    priority: index === 0 ? 1 : 0.6,
  }));
}
