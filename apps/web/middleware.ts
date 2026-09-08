import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Phase 16 (Kubernetes Deployment / WEB PHASE 16) — the web tier's own
 * security headers. `apps/api/src/app.ts`'s Phase 15 helmet config
 * deliberately turns its Content-Security-Policy OFF, with a comment
 * pointing here: the API is a JSON-only surface with no HTML rendering of
 * its own, so a real CSP belongs on the app that actually renders HTML.
 * `next.config.mjs` still layers the non-CSP headers (frame-ancestors'
 * legacy X-Frame-Options equivalent, nosniff, etc.) so both are covered
 * without either fighting the other's origin assumptions.
 *
 * A per-request nonce (not a static 'unsafe-inline') covers the one inline
 * script this app ships on purpose — `<ThemeScript>`, which must run before
 * first paint to avoid a light/dark flash and therefore can't be an
 * external file. Next.js's own framework-injected scripts automatically
 * adopt this same nonce once it's present in the CSP header — see
 * https://nextjs.org/docs/app/building-your-application/configuring/content-security-policy.
 *
 * Also still does what this file did before this phase: stamps the request
 * path onto an `x-pathname` header, since Server Components/layouts can't
 * see it directly — `app/(app)/layout.tsx` reads it back to build an
 * accurate `/login?next=<path>` redirect for anonymous users
 * (cross-cutting requirement #1).
 */
export function middleware(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isProduction = process.env.NODE_ENV === "production";

  const csp = [
    `default-src 'self'`,
    // 'unsafe-eval' is required by Next's dev-mode HMR/React Refresh
    // runtime only — never present in a production response.
    `script-src 'self' 'nonce-${nonce}'${isProduction ? "" : " 'unsafe-eval'"}`,
    // Tailwind utility classes plus Radix primitives (Dialog/Tooltip/etc.)
    // set inline `style` attributes at runtime; there is no practical nonce
    // path for those today, so style-src stays 'unsafe-inline'. This is a
    // narrower, documented exception — script-src (the higher-value target
    // for injection) does not carry the same relaxation.
    `style-src 'self' 'unsafe-inline'`,
    // Avatars/banners are blobs on the CREATOR'S OWN PDS (an arbitrary
    // domain, per the AT Protocol hosting model — see docs/architecture.md)
    // and gated media is served through short-lived signed URLs from
    // whichever S3-compatible bucket production points at (also not a
    // fixed, allow-listable domain). `https:` is the narrowest allowlist
    // that doesn't hard-code a specific provider domain into this app.
    `img-src 'self' https: data: blob:`,
    `media-src 'self' https:`,
    `font-src 'self' data:`,
    // The browser only ever talks to this same origin's /api/* proxy (see
    // next.config.mjs's rewrites) — no third-party API calls exist.
    `connect-src 'self'`,
    `frame-ancestors 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `object-src 'none'`,
    ...(isProduction ? [`upgrade-insecure-requests`] : []),
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("x-pathname", request.nextUrl.pathname);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    // Skip static assets (immutable, no HTML to protect) and /api/* (the
    // proxy target already carries the API's own Phase 15 security headers
    // — see apps/api/src/app.ts — and this middleware's nonce/nonce-header
    // rewrite has nothing to do there).
    "/((?!_next/static|_next/image|favicon.ico|api/).*)",
  ],
};
