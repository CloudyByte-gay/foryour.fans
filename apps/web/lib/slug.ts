/*
 * Client-side mirror of the slug rules in
 * apps/api/src/services/creators.ts (`SLUG_PATTERN`, `RESERVED_SLUGS`,
 * `validateSlug`). The server re-validates on every write — this is UX only.
 * Keep the two in sync; `packages/shared` isn't used here to avoid pulling
 * server deps (ioredis) into the browser bundle, same call as lib/csrf.ts.
 */

export const SLUG_MIN = 3;
export const SLUG_MAX = 32;

/** 3–32 chars, lowercase alphanumeric + hyphen, no leading/trailing hyphen. */
export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])?$/;

export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  "api",
  "admin",
  "login",
  "logout",
  "dashboard",
  "become-a-creator",
  "creator",
  "creators",
  "discover",
  "search",
  "settings",
  "help",
  "support",
  "about",
  "terms",
  "privacy",
  "static",
  "assets",
  "c",
  "www",
  "me",
  "health",
  "ready",
  "null",
  "undefined",
]);

/** Returns a human-readable problem, or `null` if the slug's shape is valid. */
export function validateSlugShape(slug: string): string | null {
  if (slug.length < SLUG_MIN || slug.length > SLUG_MAX) {
    return `Must be ${SLUG_MIN}–${SLUG_MAX} characters.`;
  }
  if (!SLUG_PATTERN.test(slug)) {
    return "Lowercase letters, numbers and hyphens only — and it can't start or end with a hyphen.";
  }
  if (RESERVED_SLUGS.has(slug)) {
    return `"${slug}" is reserved and can't be used.`;
  }
  return null;
}

/** Best-effort cleanup as the user types: lowercase, strip invalid chars. */
export function sanitizeSlugInput(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, SLUG_MAX);
}
