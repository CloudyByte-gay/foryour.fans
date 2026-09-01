# Architecture

Status: Phases 1–5 complete (Repository Foundation, AT Protocol Identity and OAuth, Custom AT Protocol Lexicons, Creator Accounts, Subscription Tiers). This document grows with each phase; see `docs/build-plan.md` for the phase tracker and `prompts/full.md` for the full spec.

## Shape of the system

A pnpm workspace monorepo — a modular monolith, not microservices, per the spec's explicit preference. Two deployable apps (`apps/api`, `apps/web`), everything else is a library package consumed via the `workspace:*` protocol.

```text
apps/web (Next.js)  ──same-origin /api/* rewrite──▶  apps/api (Fastify)
                                                            │
                                                            ├──▶ packages/database (Prisma) ──▶ Postgres
                                                            ├──▶ packages/shared   (Redis client, Did type)
                                                            ├──▶ packages/atproto  (handle/DID/PDS resolution,
                                                            │                        AT OAuth client, generic
                                                            │                        record read/write, profile fetch)
                                                            ├──▶ packages/auth     (app sessions, AT OAuth
                                                            │                        token stores, User upsert)
                                                            ├──▶ packages/lexicons (fans.foryour.* schemas + NSIDs)
                                                            ├──▶ packages/subscriptions (tier CRUD; payment
                                                            │                        provider/entitlements: Phase 6)
                                                            ├──▶ packages/content        [Phase 7]
                                                            └──▶ packages/media          [Phase 8]
```

## Identity

The DID is the canonical identity — see `User.did` (unique) in `packages/database/prisma/schema.prisma`. `handle`, `displayName`, `avatarUrl` are explicitly nullable, cached, mutable fields re-synced from the PDS on every login (`packages/auth/src/userService.ts`); nothing in the schema or code treats them as identifiers.

This app does not operate its own PDS. Users authenticate against **their own** PDS via AT Protocol OAuth (`@atproto/oauth-client-node`); we never see or store a password, app password, or anything password-shaped. See "Hosting model" in `prompts/full.md`.

## Why the web app proxies `/api/*` to the API (same-origin, not CORS)

`apps/api` and `apps/web` run on different ports. The naive approach — browser JS on `:3000` calling `fetch('http://127.0.0.1:4000/...', { credentials: 'include' })` — does not work for our session cookie: it's `SameSite=Lax`, and Lax cookies are withheld from cross-site `fetch`/XHR requests even when CORS would otherwise allow the call (Lax only permits cross-site cookies on top-level navigations). Switching to `SameSite=None; Secure` trades that problem for browser-dependent flakiness around `Secure` cookies on plain-HTTP `localhost`.

Instead, `apps/web/next.config.mjs` rewrites `/api/:path*` to the API's internal URL. From the browser's perspective every request — including the OAuth callback redirect that sets the cookie — is same-origin against `:3000`, so `SameSite=Lax` (or even `Strict`) works with no special-casing. This also matches how the app will very likely be deployed in production behind a single ingress/domain (Phase 16), so the dev and prod cookie/origin story are the same shape.

Every Server Component that needs the caller's identity (`/dashboard`, `/become-a-creator`, `/creator/settings`, `/c/[slug]`) talks to the API directly rather than through the public `/api/*` proxy, via the shared `apps/web/lib/serverApi.ts#fetchApi` helper — it calls `API_INTERNAL_URL` server-to-server, forwarding the incoming request's `Cookie` header manually, since it's already running on the server and the browser is never involved in that particular call. Client Components that mutate state (`LogoutButton`, `BecomeCreatorForm`, `CreatorSettingsForm`) go through the public `/api/*` proxy instead, since they run in the browser — and read the CSRF cookie via the shared `apps/web/lib/csrf.ts#csrfHeaders` helper rather than each reimplementing cookie parsing.

## AT OAuth client: loopback (dev) vs hosted (production)

`packages/atproto/src/oauthClient.ts` builds a `NodeOAuthClient` in one of two modes, selected by `ATPROTO_OAUTH_MODE`:

- **`loopback`** (dev default): uses `buildAtprotoLoopbackClientMetadata` from `@atproto/oauth-types`, which constructs the spec's special dev `client_id` — literally the string `http://localhost?redirect_uri=...&scope=...` (no keys, no hosted metadata document; the authorization server parses the client identity straight out of the URL). The atproto OAuth spec requires the redirect URI's host to be exactly `127.0.0.1` for this mode — this is why the app **must** be browsed at `http://127.0.0.1:3000`, not `http://localhost:3000` (see README).
- **`hosted`** (production): builds a real `OAuthClientMetadataInput` — `client_id` pointing at a hosted `/api/oauth/client-metadata.json` document, `private_key_jwt` client auth backed by an EC (P-256) key from `ATPROTO_OAUTH_PRIVATE_KEY`, and a hosted `/api/oauth/jwks.json`. Both routes are always registered (`authRoutes` in `apps/api/src/routes/auth.ts`); which metadata they serve just depends on which mode built the client.

`env.ts` refuses to start with `ATPROTO_OAUTH_MODE=loopback` under `NODE_ENV=production` — the loopback client is a public/native client with no client authentication at all, so it must never be reachable from a real deployment.

Verified manually against the live network during development: `resolveHandle('bsky.app')` resolved to a real DID and PDS, and `POST /auth/atproto/start` with a real handle produced a real Pushed Authorization Request to `bsky.social`'s live authorization server (confirmed via the returned `request_uri` and the corresponding state row landing in Redis) — this exercises handle resolution, DPoP key generation, PKCE, and PAR submission all at once, without needing a real user's interactive consent.

## Lexicons: authored JSON is committed, generated TypeScript is not

`packages/lexicons/lexicons/**/*.json` defines three record types under the `fans.foryour.*` namespace — the reverse-DNS NSID authority for the production domain, `foryour.fans` (see `docs/atproto-vs-database.md` for what belongs in each field). This was originally `dev.creator`, a placeholder pending domain selection; since no record was ever published under it, the rename was a same-day, zero-migration change once the domain was chosen — see `packages/lexicons/src/nsids.ts`.

- `fans.foryour.profile` (singleton, `key: "literal:self"`) — public creator profile.
- `fans.foryour.post` (`key: "tid"`) — public posts, referencing `fans.foryour.embed.images` for media and the core protocol's `com.atproto.label.defs#selfLabels` for content-warning labels.
- `fans.foryour.tier` (`key: "tid"`) — public subscription-tier metadata.

Two things worth knowing about how these get from JSON to usable TypeScript:

1. **`com.atproto.label.defs` is a real, live-fetched dependency, pinned like one.** Our `post` lexicon references the core protocol's own self-labels union, so it had to be fetched (`lex install com.atproto.label.defs`, from `@atproto/lex`) — a real network call to a real DID's real `com.atproto.lexicon.schema` record, resolved during development. The result (`packages/lexicons/lexicons/com/atproto/label/defs.json`) is committed alongside `lexicons.json` (the manifest pinning its CID), exactly like a vendored dependency — `pnpm build` never re-fetches it, only ever re-derives TypeScript from what's on disk.
2. **The generated TypeScript (`packages/lexicons/src/lexicons/**`) is gitignored**, for the same reason `packages/database`'s Prisma client is: it's pure derived output. `packages/lexicons`'s own `build` script runs `lex build` before `tsc`, so `pnpm build` regenerates it automatically — see "Why workspace packages build to dist/, not source" below for why this ordering matters project-wide, not just here.

Each generated namespace (e.g. `fans.foryour.profile`) exposes `$validate`/`$safeValidate`/`$build`/`$matches` helpers and a `Main` type derived directly from the schema — see `packages/lexicons/src/lexicons.test.ts` for how these get used, including a compile-time (`@ts-expect-error`) regression test that a billing-shaped field can't be assigned through the typed builder, since the runtime format itself is "open" (unknown properties aren't rejected) and can't enforce that on its own.

The NSIDs themselves (`fans.foryour.profile`, etc.) are centralized in `packages/lexicons/src/nsids.ts` as compile-time constants, not a live `process.env` read — see the comment at the top of that file for why a live env toggle would be actively wrong here (an NSID must exactly match the schema `id` it was compiled against; drifting the two apart at runtime would silently corrupt data rather than harmlessly reconfigure anything).

## Creators: the AT record is written first, the DB row second

`apps/api/src/services/creators.ts` orchestrates both `POST /creators` and `PATCH /creators/me`. The ordering is deliberate and identical in both: **publish the `fans.foryour.profile` AT record before touching Postgres.** A `Creator` row must never exist locally without a corresponding AT record — becoming/being a creator is fundamentally a "publish to the open network" action (see `docs/atproto-vs-database.md`). If the AT write fails (`AtRecordPublishError`), the route returns 502 and nothing in Postgres changes — not even an unrelated field like `slug` in the same request, so a flaky PDS never leaves the local cache diverged from what's actually published. Conversely, updating *only* `slug` never talks to the network at all (see `updateCreator`'s `hasProfileFields` check in `apps/api/src/routes/creators.ts`) — there's no reason to re-publish a record whose content didn't change.

`Creator.displayName`/`bio`/`website` are a write-through **cache** of that AT record, not the source of truth — populated only by our own successful writes, following the same "cached, mutable, re-synced" pattern Phase 2 established for `User.handle`/`displayName`/`avatarUrl`. `GET /creators/:identifier` and `GET /creators/me` read this cache, never the network, so a public creator-profile page never has a live PDS round trip on its hot path — full network-backed indexing (handling *other* apps' writes to the same record, not just ours) is Phase 10's job.

`avatar`/`banner` are in the Lexicon but deliberately not settable yet — they're blobs, and blob upload is Phase 8. `apps/api/src/routes/creators.ts`'s zod schemas simply don't accept those fields yet.

### Creator identifier resolution

`GET /creators/:identifier` accepts a DID, an AT handle, or a slug, and dispatches on shape alone (`classifyIdentifier` in `apps/api/src/services/creators.ts`): starts with `did:` → DID; contains a `.` → handle; otherwise → slug. Handle-shaped lookups resolve against the **locally cached** `User.handle` (a join, not a live `resolveHandle()` call) — deliberately, to avoid putting a network dependency on a public read hot path before Phase 10's real indexing exists. This means a handle-shaped lookup can be briefly stale if the creator changed their AT handle and hasn't logged back in since (which re-syncs it); DID- and slug-based lookups are unaffected. A suspended creator (`Creator.status !== "ACTIVE"`) is invisible to this route entirely — `findActiveCreatorByIdentifier` returns `null`, same as not existing.

### Slugs

Validated against `SLUG_PATTERN` (3–32 chars, lowercase alphanumeric + internal hyphens only) and a reserved-word list covering the app's own routes plus obvious squatting targets (`RESERVED_SLUGS` in `apps/api/src/services/creators.ts`). Changing an existing slug is rate-limited to once per 7 days (`Creator.slugUpdatedAt`) — **but the initial pick at signup doesn't count as a "change."** `slugUpdatedAt` starts `null` and is only ever set by `updateCreator`; this was a real bug caught by testing during development (`slugUpdatedAt` was originally initialized to `now()` at creation, which meant the cooldown blocked a creator's very first slug edit, made moments after signup — see the migration `creator_slug_updated_at_nullable`). A changed slug's old URL simply 404s — there's no slug-history/redirect table yet; see README "Known limitations."

## Subscription tiers live in packages/subscriptions, not apps/api

`creators.ts` (Phase 4) lives in `apps/api/src/services/` because there's no dedicated package for it in the target repo structure. Tiers are different: `prompts/full.md`'s target structure names `packages/subscriptions` explicitly for "tiers, billing, entitlements." The first Phase 5 draft put tier logic in `apps/api/src/services/tiers.ts` anyway (following the Phase 4 precedent too literally); this was corrected before merging, because it's not just a style inconsistency — **a package cannot depend on an app** in this monorepo's layering, so if `packages/subscriptions` ever needed the same "inject a fake AT-record writer for tests" shape `creators.ts` uses, it couldn't import it from `apps/api`. The fix: `PublishAtRecord`/`DeleteAtRecord`/`AtRecordPublishError`/`AtRecordDeleteError` moved to `packages/atproto/src/injection.ts` (a natural home — it's the DID-bound shape of `packages/atproto`'s own `putRecord`/`deleteRecord`), and the actual tier domain logic (`createTier`/`updateTier`/`deactivateTier`/`getOwnedTier`/`listActiveTiers`) lives in `packages/subscriptions/src/tiers.ts`. `apps/api/src/routes/tiers.ts` stays thin — HTTP parsing, zod validation, ownership lookup, error-to-status-code mapping — importing the domain logic from `@foryour-fans/subscriptions` like any other workspace package.

## Tiers: tid rkeys are generated once and reused, not regenerated per write

Unlike the creator profile record (`key: "literal:self"` — one fixed rkey, `"self"`, forever), `fans.foryour.tier` is `key: "tid"`: a creator can have many tiers, each its own record, and *we* choose the rkey (the PDS doesn't assign one). `SubscriptionTier.atRkey` stores the tid generated at creation time (`packages/atproto/src/records.ts#nextTid`, wrapping `@atproto/common-web`'s `TID.nextStr()`); every subsequent `PATCH` reuses that exact rkey via `putRecord`, and `DELETE` (deactivation) targets it via `deleteRecord`. Generating a fresh tid on update would silently orphan the old AT record instead of replacing it — `packages/subscriptions/src/tiers.test.ts` and `apps/api/test/tiers.test.ts`'s "republishes under the SAME rkey" test exist specifically to guard this.

A second difference from creators: **every** tier field a `PATCH` can touch (`name`, `description`, `priceCents`/`monthlyPrice`, `currency`, `sortOrder`) is part of the public AT record — there's no DB-only field analogous to a creator's `slug`. So `updateTier` has no `hasProfileFields`-style optimization; any non-empty patch republishes the full merged record. An empty patch body still no-ops without a network call (checked explicitly), and `deactivateTier` checks `isActive` before calling `deleteAtRecord` at all, so calling `DELETE` on an already-inactive tier is idempotent by never attempting a second delete — see the doc comment on `packages/atproto/src/records.ts#deleteRecord` for why that's a real necessity, not defensive-programming reflex: whether deleting an already-absent AT record errors on a real PDS was never verified against the live network.

`GET /creators/:identifier/tiers` returns only `isActive: true` tiers, sorted by `sortOrder`, reusing Phase 4's `findActiveCreatorByIdentifier` — a tier's public listing and its creator's public visibility are gated the same way. Deactivated tiers are never deleted from Postgres (per `prompts/full.md`'s "existing subscriptions must retain historical tier information"), just hidden from this listing and stripped of their AT record.

## Two very different "sessions"

It would be easy to conflate these; the code keeps them in separate packages/stores on purpose:

1. **The AT OAuth grant** (`NodeOAuthClient`'s own `sessionStore`) — the DPoP-bound access/refresh tokens that let *our backend* act on a DID's behalf against *their* PDS. This is durable, sensitive credential material, so it's Postgres-backed (`AtprotoOAuthSession`, `packages/auth/src/atprotoStores.ts`), keyed by DID, and deliberately outlives any particular browser session — a later background job (e.g. publishing a scheduled post) needs it to still be there even if the creator isn't currently "logged in."
2. **Our application's login session** — "is this browser currently logged in, and as whom." Redis-backed (`packages/auth/src/appSession.ts`), keyed by an opaque random token that's the *only* thing the `ff_session` cookie carries. Session data (the DID, a CSRF token, `createdAt`) lives entirely server-side, so a session can be revoked immediately just by deleting the Redis key — nothing about it is signed or otherwise trusted from the client. The cookie isn't signed either: unlike a JWT-shaped cookie, a random opaque token carries no claims worth forging, so signing would add complexity without adding security here.

There's a third, short-lived Redis-backed store — `NodeOAuthClient`'s `stateStore` (`createRedisStateStore`) — which only exists to survive the ~seconds-to-minutes round trip of the OAuth redirect itself (CSRF/PKCE state), with a 10-minute TTL.

## CSRF and session resolution

Every mutating authenticated route (`POST /auth/logout`, `POST /creators`, `PATCH /creators/me`) requires an `x-csrf-token` header matching the CSRF token stored server-side in the session (double-submit cookie pattern: the token is also set as a *non*-httpOnly `ff_csrf` cookie purely so browser JS can read and echo it back — the server never trusts the cookie value by itself, only the header-vs-session-store comparison). This now runs through one shared implementation, `requireCsrf` in `apps/api/src/plugins/session.ts` (paired with `requireSession` for read-only authenticated routes) — Phase 2 had this logic hand-inlined in the logout handler with a comment promising to extract it "when a second route needs it"; Phase 4 is that second (and third) route, so the extraction happened now rather than being copy-pasted again.

**A real Fastify encapsulation pitfall, worth knowing before adding more routes:** `sessionPlugin` (the `onRequest` hook that resolves `request.session` from the cookie via a Redis lookup) must NOT be registered globally on the root app instance — Fastify's plugin encapsulation means a hook registered inside `app.register(somePlugin)` only applies within that plugin's scope, but a hook added directly via `app.addHook(...)` on the root instance applies to *every* route, including `/health` and `/ready`. Registering it globally would have quietly reintroduced the exact dependency Phase 1 explicitly designed `/health` to avoid (an external system on the liveness path). The fix in `apps/api/src/app.ts`: `sessionPlugin`, `authRoutes`, and `creatorsRoutes` are all registered together inside one `app.register(async (scope) => { ... })` block, so the Redis-backed hook is scoped to exactly the routes that need `request.session` — health/ready, registered as siblings outside that block, never touch it.

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

Per the spec's phase discipline: payment processing (`prompts/full.md` is explicit that Phase 5 must not implement it — tiers exist, but nothing can actually be subscribed to yet), private content, media, blob uploads (so no creator avatar/banner yet, and no tier images). `packages/content` and `media` remain empty scaffolds.

## Known limitations

See the README's "Known limitations" section — kept there rather than duplicated here since it's the first thing a new contributor reads.

## Next phase

Phase 6 — Subscription and Payment Abstraction.
