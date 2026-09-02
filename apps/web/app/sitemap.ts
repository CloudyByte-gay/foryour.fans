import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

/**
 * Public marketing routes only. Creator pages get added here once discovery
 * indexing exists (WEB PHASE 10); legal pages are intentionally left out
 * because they're `noindex` placeholders.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: `${SITE_URL}/`, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE_URL}/about`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${SITE_URL}/discover`, lastModified: now, changeFrequency: "daily", priority: 0.6 },
  ];
}
