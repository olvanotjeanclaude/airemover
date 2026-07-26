import type { MetadataRoute } from "next";
import { SITE } from "@/constants/site";

/** The tool is the whole site: one page, nothing else to crawl. */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: SITE.url,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 1,
    },
  ];
}
