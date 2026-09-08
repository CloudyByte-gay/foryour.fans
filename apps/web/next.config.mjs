// Deliberately a plain `process.env` read, not lib/env.ts's `loadWebEnv()`
// (next.config.mjs runs before the app's own module graph, and therefore
// before zod validation, exists) — but also, verified directly, EFFECTIVELY
// A BUILD-TIME-ONLY VALUE: Next.js resolves `rewrites()` below into a
// static routes manifest at `next build` time and never re-invokes this
// function at server start or per-request. Booting the built server with a
// different `API_INTERNAL_URL` than was present at build time still
// proxies to the build-time one. This is why
// infrastructure/docker/web.Dockerfile bakes API_INTERNAL_URL in as a
// build ARG rather than leaving it to a Kubernetes ConfigMap — see that
// file's own comment. lib/serverApi.ts's own direct fetch (bypassing this
// rewrite) is NOT subject to this — it reads the same env var live, at
// actual request time, since it's plain application code, not a
// next.config.mjs hook.
const API_INTERNAL_URL = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4000";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Phase 16 (Kubernetes Deployment) — traces the minimal set of files/
  // node_modules this app actually needs at runtime into .next/standalone,
  // so the production Docker image (infrastructure/docker/web.Dockerfile)
  // ships a self-contained `node server.js`, not the full workspace plus
  // devDependencies. See https://nextjs.org/docs/pages/api-reference/next-config-js/output.
  output: "standalone",
  // Proxies /api/* to apps/api so the browser only ever talks to this
  // origin. This is what makes the AT OAuth session cookie same-origin
  // instead of split across two ports — see docs/architecture.md.
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${API_INTERNAL_URL}/:path*`,
      },
    ];
  },
  // Phase 16 — the non-CSP security headers (CSP itself is per-request,
  // nonce-based, and lives in middleware.ts since it needs a fresh nonce
  // every request). These are static and coordinate with, rather than
  // duplicate, apps/api/src/app.ts's Phase 15 helmet config: HSTS/nosniff/
  // referrer-policy are the same values helmet would apply, kept consistent
  // across both origins so a browser sees one coherent policy regardless of
  // which app answered a given request.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          ...(process.env.NODE_ENV === "production"
            ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }]
            : []),
        ],
      },
    ];
  },
};

export default nextConfig;
