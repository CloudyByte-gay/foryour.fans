import { z } from "zod";

/**
 * Typed, validated environment configuration for apps/web — the WEB PHASE 16
 * counterpart to apps/api/src/config/env.ts. Fails fast on an invalid/missing
 * value at server startup instead of a later, harder-to-place runtime error.
 *
 * Every var here is SERVER-ONLY. `NEXT_PUBLIC_*` vars are inlined into the
 * client bundle at build time by Next.js itself, so `loadEnv()` deliberately
 * does not read them through `process.env` at request time — see
 * lib/site.ts's own `NEXT_PUBLIC_SITE_URL` read for the one public var this
 * app uses, and cross-cutting requirement #8 in prompts/web.md ("no secrets
 * in the bundle", "NEXT_PUBLIC_* is for non-sensitive config only") for why
 * that boundary is deliberate, not an oversight.
 *
 * Session/theme/CSRF cookie NAMES are not env vars (they're stable string
 * constants, not deployment-varying config): `packages/auth`'s
 * `SESSION_COOKIE_NAME`/`CSRF_COOKIE_NAME` ("ff_session"/"ff_csrf") and
 * `lib/theme.ts`'s `THEME_COOKIE_NAME` ("ff_theme"). `lib/csrf.ts` duplicates
 * the CSRF cookie name as a literal rather than importing it from
 * `@foryour-fans/auth`, because that package pulls in `ioredis`/
 * `@prisma/client` — server-only dependencies that must never reach a
 * browser bundle (see that file's own comment). Documented here, alongside
 * the real env vars, per WEB PHASE 16's "document every server-only var...
 * session/theme cookie names" instruction — see also README.md's
 * "Web app" section.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  /**
   * Where lib/serverApi.ts's direct server-to-server fetch calls apps/api
   * — read live, per request, exactly as this schema implies. The browser
   * never sees this value; it only ever calls same-origin /api/*, which is
   * what keeps the AT OAuth session cookie same-origin instead of split
   * across two ports (see docs/architecture.md). NOTE: next.config.mjs
   * ALSO reads this same var to configure that /api/* rewrite, but — a
   * real, verified nuance, not a hypothetical — that config's `rewrites()`
   * gets resolved into a static manifest at `next build` time and is never
   * re-evaluated at request time, so changing this var at container-start
   * only affects lib/serverApi.ts's calls, not the browser-facing proxy.
   * See infrastructure/docker/web.Dockerfile's own comment.
   */
  API_INTERNAL_URL: z.string().url().default("http://127.0.0.1:4000"),
});

export type WebEnv = z.infer<typeof envSchema>;

export function loadWebEnv(source: NodeJS.ProcessEnv = process.env): WebEnv {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`).join("\n");
    throw new Error(`Invalid apps/web environment configuration:\n${issues}`);
  }
  return result.data;
}
