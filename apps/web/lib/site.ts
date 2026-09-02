/**
 * Public origin the web app is served from. `NEXT_PUBLIC_SITE_URL` is
 * non-sensitive config (requirement #8) used for canonical URLs, OpenGraph
 * URLs, the sitemap and robots. Falls back to the dev origin.
 */
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? "http://127.0.0.1:3000"
).replace(/\/$/, "");
