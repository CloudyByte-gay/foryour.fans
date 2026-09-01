# Architecture

Status: Phase 1 (Repository Foundation) + Phase 2 (AT Protocol Identity and OAuth) + Phase 3 (Custom AT Protocol Lexicons) complete. This document grows with each phase; see `docs/build-plan.md` for the phase tracker and `prompts/full.md` for the full spec.

## Shape of the system

A pnpm workspace monorepo — a modular monolith, not microservices, per the spec's explicit preference. Two deployable apps (`apps/api`, `apps/web`), everything else is a library package consumed via the `workspace:*` protocol.

```text
apps/web (Next.js)  ──same-origin /api/* rewrite──▶  apps/api (Fastify)
                                                            │
                                                            ├──▶ packages/database (Prisma) ──▶ Postgres
                                                            ├──▶ packages/shared   (Redis client, Did type)
                                                            ├──▶ packages/atproto  (handle/DID/PDS resolution,
                                                            │                        AT OAuth client, profile fetch)
                                                            ├──▶ packages/auth     (app sessions, AT OAuth
                                                            │                        token stores, User upsert)
                                                            ├──▶ packages/lexicons       [Phase 3]
                                                            ├──▶ packages/content        [Phase 7]
                                                            ├──▶ packages/subscriptions  [Phases 5–6]
                                                            └──▶ packages/media          [Phase 8]
```

## Identity

The DID is the canonical identity — see `User.did` (unique) in `packages/database/prisma/schema.prisma`. `handle`, `displayName`, `avatarUrl` are explicitly nullable, cached, mutable fields re-synced from the PDS on every login (`packages/auth/src/userService.ts`); nothing in the schema or code treats them as identifiers.

This app does not operate its own PDS. Users authenticate against **their own** PDS via AT Protocol OAuth (`@atproto/oauth-client-node`); we never see or store a password, app password, or anything password-shaped. See "Hosting model" in `prompts/full.md`.

## Why the web app proxies `/api/*` to the API (same-origin, not CORS)

`apps/api` and `apps/web` run on different ports. The naive approach — browser JS on `:3000` calling `fetch('http://127.0.0.1:4000/...', { credentials: 'include' })` — does not work for our session cookie: it's `SameSite=Lax`, and Lax cookies are withheld from cross-site `fetch`/XHR requests even when CORS would otherwise allow the call (Lax only permits cross-site cookies on top-level navigations). Switching to `SameSite=None; Secure` trades that problem for browser-dependent flakiness around `Secure` cookies on plain-HTTP `localhost`.

Instead, `apps/web/next.config.mjs` rewrites `/api/:path*` to the API's internal URL. From the browser's perspective every request — including the OAuth callback redirect that sets the cookie — is same-origin against `:3000`, so `SameSite=Lax` (or even `Strict`) works with no special-casing. This also matches how the app will very likely be deployed in production behind a single ingress/domain (Phase 16), so the dev and prod cookie/origin story are the same shape.

The one route that talks to the API directly rather than through the public `/api/*` proxy is `apps/web/app/dashboard/page.tsx` — a Server Component that calls `API_INTERNAL_URL` server-to-server (forwarding the incoming request's `Cookie` header manually), since it's already running on the server and the browser is never involved in that particular call.

## AT OAuth client: loopback (dev) vs hosted (production)

`packages/atproto/src/oauthClient.ts` builds a `NodeOAuthClient` in one of two modes, selected by `ATPROTO_OAUTH_MODE`:

- **`loopback`** (dev default): uses `buildAtprotoLoopbackClientMetadata` from `@atproto/oauth-types`, which constructs the spec's special dev `client_id` — literally the string `http://localhost?redirect_uri=...&scope=...` (no keys, no hosted metadata document; the authorization server parses the client identity straight out of the URL). The atproto OAuth spec requires the redirect URI's host to be exactly `127.0.0.1` for this mode — this is why the app **must** be browsed at `http://127.0.0.1:3000`, not `http://localhost:3000` (see README).
- **`hosted`** (production): builds a real `OAuthClientMetadataInput` — `client_id` pointing at a hosted `/api/oauth/client-metadata.json` document, `private_key_jwt` client auth backed by an EC (P-256) key from `ATPROTO_OAUTH_PRIVATE_KEY`, and a hosted `/api/oauth/jwks.json`. Both routes are always registered (`authRoutes` in `apps/api/src/routes/auth.ts`); which metadata they serve just depends on which mode built the client.

`env.ts` refuses to start with `ATPROTO_OAUTH_MODE=loopback` under `NODE_ENV=production` — the loopback client is a public/native client with no client authentication at all, so it must never be reachable from a real deployment.

Verified manually against the live network during development: `resolveHandle('bsky.app')` resolved to a real DID and PDS, and `POST /auth/atproto/start` with a real handle produced a real Pushed Authorization Request to `bsky.social`'s live authorization server (confirmed via the returned `request_uri` and the corresponding state row landing in Redis) — this exercises handle resolution, DPoP key generation, PKCE, and PAR submission all at once, without needing a real user's interactive consent.

## Lexicons: authored JSON is committed, generated TypeScript is not

`packages/lexicons/lexicons/**/*.json` defines three record types under the `dev.creator.*` placeholder namespace (see `docs/atproto-vs-database.md` for what belongs in each, field by field):

- `dev.creator.profile` (singleton, `key: "literal:self"`) — public creator profile.
- `dev.creator.post` (`key: "tid"`) — public posts, referencing `dev.creator.embed.images` for media and the core protocol's `com.atproto.label.defs#selfLabels` for content-warning labels.
- `dev.creator.tier` (`key: "tid"`) — public subscription-tier metadata.

Two things worth knowing about how these get from JSON to usable TypeScript:

1. **`com.atproto.label.defs` is a real, live-fetched dependency, pinned like one.** Our `post` lexicon references the core protocol's own self-labels union, so it had to be fetched (`lex install com.atproto.label.defs`, from `@atproto/lex`) — a real network call to a real DID's real `com.atproto.lexicon.schema` record, resolved during development. The result (`packages/lexicons/lexicons/com/atproto/label/defs.json`) is committed alongside `lexicons.json` (the manifest pinning its CID), exactly like a vendored dependency — `pnpm build` never re-fetches it, only ever re-derives TypeScript from what's on disk.
2. **The generated TypeScript (`packages/lexicons/src/lexicons/**`) is gitignored**, for the same reason `packages/database`'s Prisma client is: it's pure derived output. `packages/lexicons`'s own `build` script runs `lex build` before `tsc`, so `pnpm build` regenerates it automatically — see "Why workspace packages build to dist/, not source" below for why this ordering matters project-wide, not just here.

Each generated namespace (e.g. `dev.creator.profile`) exposes `$validate`/`$safeValidate`/`$build`/`$matches` helpers and a `Main` type derived directly from the schema — see `packages/lexicons/src/lexicons.test.ts` for how these get used, including a compile-time (`@ts-expect-error`) regression test that a billing-shaped field can't be assigned through the typed builder, since the runtime format itself is "open" (unknown properties aren't rejected) and can't enforce that on its own.

The NSIDs themselves (`dev.creator.profile`, etc.) are centralized in `packages/lexicons/src/nsids.ts` as compile-time constants, not a live `process.env` read, even though `prompts/full.md` describes the namespace as "configurable through environment variables" — see the comment at the top of that file for why a live env toggle would be actively wrong here (an NSID must exactly match the schema `id` it was compiled against; drifting the two apart at runtime would silently corrupt data rather than harmlessly reconfigure anything).

## Two very different "sessions"

It would be easy to conflate these; the code keeps them in separate packages/stores on purpose:

1. **The AT OAuth grant** (`NodeOAuthClient`'s own `sessionStore`) — the DPoP-bound access/refresh tokens that let *our backend* act on a DID's behalf against *their* PDS. This is durable, sensitive credential material, so it's Postgres-backed (`AtprotoOAuthSession`, `packages/auth/src/atprotoStores.ts`), keyed by DID, and deliberately outlives any particular browser session — a later background job (e.g. publishing a scheduled post) needs it to still be there even if the creator isn't currently "logged in."
2. **Our application's login session** — "is this browser currently logged in, and as whom." Redis-backed (`packages/auth/src/appSession.ts`), keyed by an opaque random token that's the *only* thing the `ff_session` cookie carries. Session data (the DID, a CSRF token, `createdAt`) lives entirely server-side, so a session can be revoked immediately just by deleting the Redis key — nothing about it is signed or otherwise trusted from the client. The cookie isn't signed either: unlike a JWT-shaped cookie, a random opaque token carries no claims worth forging, so signing would add complexity without adding security here.

There's a third, short-lived Redis-backed store — `NodeOAuthClient`'s `stateStore` (`createRedisStateStore`) — which only exists to survive the ~seconds-to-minutes round trip of the OAuth redirect itself (CSRF/PKCE state), with a 10-minute TTL.

## CSRF

`POST /auth/logout` requires an `x-csrf-token` header matching the CSRF token stored server-side in the session (double-submit cookie pattern: the token is also set as a *non*-httpOnly `ff_csrf` cookie purely so browser JS can read and echo it back — the server never trusts the cookie value by itself, only the header-vs-session-store comparison). This is the only mutating authenticated route that exists yet; every future one must do the same check.

## Why workspace packages build to `dist/`, not source

Every package's `package.json` points `main`/`types` at `./dist/index.js` / `./dist/index.d.ts`, and each has a `build` script (`tsc -p tsconfig.json`). This was **not** the first approach — packages initially pointed straight at `./src/index.ts`, which works fine for `tsc` (via TypeScript's own module resolution) but breaks at actual runtime: `node apps/api/dist/server.js` imports `@foryour-fans/database`, and plain Node cannot execute a `.ts` file. `pnpm build` builds packages in dependency-topological order, so `apps/api`'s build always sees already-built `dist/` output from its workspace dependencies.

Practical consequences:

- Editing a package other than `apps/api`/`apps/web` requires re-running `pnpm build` before the change is visible elsewhere, even in dev mode — `tsx watch` on `apps/api/src` does not rebuild upstream workspace packages for you.
- **`pnpm build` must run before `pnpm lint` / `pnpm typecheck` / `pnpm test`** on a clean checkout, not after — `tsc` resolves cross-package imports via each package's `types` field (pointing at `dist/*.d.ts`), and Vitest resolves them the same way at runtime via `main`. This bit us once already: the CI workflow originally ran test before build and would have failed on a fresh clone despite passing locally (where `dist/` already existed from prior work). `.github/workflows/ci.yml` and the README's command table both reflect the corrected order now.

## Config and secrets

`apps/api/src/config/env.ts` parses `process.env` through a `zod` schema at startup (`loadEnv`) and throws with the full list of validation errors if anything is missing/malformed. Nothing reads `process.env` directly outside this module (`apps/web`'s `next.config.mjs`/dashboard Server Component are the only exceptions, since Next has no equivalent central entrypoint to hook this into yet).

## Health vs. readiness

- `GET /health` never touches external systems — pure liveness.
- `GET /ready` takes an injected `checkDatabaseConnection` function rather than importing Prisma directly, so tests can simulate a live-vs-down database without a real Postgres. `apps/api/src/server.ts` wires the real check to `prisma.$queryRaw\`SELECT 1\``. Verified manually end-to-end: 200 with Postgres up, 503 (no stack trace leaked) with it stopped.

## Error handling

`apps/api/src/plugins/error-handler.ts` registers a single Fastify error handler: 5xx responses always return a generic "Internal Server Error" message (the real error is logged server-side with the request ID, never sent to the client); 4xx responses pass through `error.message`. A 404 handler returns the same `{ error: { message, statusCode, requestId } }` shape as everything else.

## What's deliberately not here yet

Per the spec's phase discipline: creators, subscription tiers, payments, private content, media. `packages/content`, `subscriptions`, `media`, `lexicons` remain empty scaffolds.

## Known limitations

See the README's "Known limitations" section — kept there rather than duplicated here since it's the first thing a new contributor reads.

## Next phase

Phase 4 — Creator Accounts.
