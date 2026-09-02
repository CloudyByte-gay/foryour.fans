import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Authenticated app, auth flow, API proxy and the dev gallery — nothing
      // to index and nothing safe to expose in search.
      disallow: [
        "/api/",
        "/auth/",
        "/dashboard",
        "/creator/",
        "/settings",
        "/subscriptions",
        "/dev/",
      ],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
