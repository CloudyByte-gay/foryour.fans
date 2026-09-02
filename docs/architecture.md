# Architecture

Status: Phases 1–7 complete (Repository Foundation, AT Protocol Identity and OAuth, Custom AT Protocol Lexicons, Creator Accounts, Subscription Tiers, Subscription and Payment Abstraction, Private Content Architecture). This document grows with each phase; see `docs/build-plan.md` for the phase tracker and `prompts/full.md` for the full spec.

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
                                                            ├──▶ packages/subscriptions (tier CRUD, Payment/
                                                            │                        PayoutProvider + fakes,
                                                            │                        webhooks, entitlements)
                                                            ├──▶ packages/content  (ContentRepository interface,
                                                            │                        PrivateContentRepository,
                                                            │                        AtprotoSpacesContentRepository
                                                            │                        stub)
                                                            └──▶ packages/media          [Phase 8]
```

## Identity

The DID is the canonical identity — see `User.did` (unique) in `packages/database/prisma/schema.prisma`. `handle`, `displayName`, `avatarUrl` are explicitly nullable, cached, mutable fields re-synced from the PDS on every login (`packages/auth/src/userService.ts`); nothing in the schema or code treats them as identifiers.

This app does not operate its own PDS. Users authenticate against **their own** PDS via AT Protocol OAuth (`@atproto/oauth-client-node`); we never see or store a password, app password, or anything password-shaped. See "Hosting model" in `prompts/full.md`.

## Why the web app proxies `/api/*` to the API (same-origin, not CORS)

`apps/api` and `apps/web` run on different ports. The naive approach — browser JS on `:3000` calling `fetch('http://127.0.0.1:4000/...', { credentials: 'include' })` — does not work for our session cookie: it's `SameSite=Lax`, and Lax cookies are withheld from cross-site `fetch`/XHR requests even when CORS would otherwise allow the call (Lax only permits cross-site cookies on top-level navigations). Switching to `SameSite=None; Secure` trades that problem for browser-dependent flakiness around `Secure` cookies on plain-HTTP `localhost`.

Instead, `apps/web/next.config.mjs` rewrites `/api/:path*` to the API's internal URL. From the browser's perspective every request — including the OAuth callback redirect that sets the cookie — is same-origin against `:3000`, so `SameSite=Lax` (or even `Strict`) works with no special-casing. This also matches how the app will very likely be deployed in production behind a single ingress/domain (Phase 16), so the dev and prod cookie/origin story are the same shape.

Every Server Component that needs the caller's identity (`/dashboard`, `/become-a-creator`, `/creator/settings`, `/c/[handle]`) talks to the API directly rather than through the public `/api/*` proxy, via the shared `apps/web/lib/serverApi.ts#fetchApi` helper — it calls `API_INTERNAL_URL` server-to-server, forwarding the incoming request's `Cookie` header manually, since it's already running on the server and the browser is never involved in that particular call. Client Components that mutate state (`LogoutButton`, `BecomeCreatorForm`, `CreatorSettingsForm`) go through the public `/api/*` proxy instead, since they run in the browser — and read the CSRF cookie via the shared `apps/web/lib/csrf.ts#csrfHeaders` helper rather than each reimplementing cookie parsing.

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

`apps/api/src/services/creators.ts` orchestrates both `POST /creators` and `PATCH /creators/me`. The ordering is deliberate and identical in both: **publish the `fans.foryour.profile` AT record before touching Postgres.** A `Creator` row must never exist locally without a corresponding AT record — becoming/being a creator is fundamentally a "publish to the open network" action (see `docs/atproto-vs-database.md`). If the AT write fails (`AtRecordPublishError`), the route returns 502 and nothing in Postgres changes, so a flaky PDS never leaves the local cache diverged from what's actually published. Conversely, an empty `PATCH /creators/me` (no profile fields) never talks to the network at all (see `updateCreator`'s `hasProfileFields` check in `apps/api/src/routes/creators.ts`) — there's no reason to re-publish a record whose content didn't change. `POST /creators` now takes profile fields only; there is nothing else to a creator account (see "Creator page address" below).

`Creator.displayName`/`bio`/`website` are a write-through **cache** of that AT record, not the source of truth — populated only by our own successful writes, following the same "cached, mutable, re-synced" pattern Phase 2 established for `User.handle`/`displayName`/`avatarUrl`. `GET /creators/:identifier` and `GET /creators/me` read this cache, never the network, so a public creator-profile page never has a live PDS round trip on its hot path — full network-backed indexing (handling *other* apps' writes to the same record, not just ours) is Phase 10's job.

`avatar`/`banner` are in the Lexicon but deliberately not settable yet — they're blobs, and blob upload is Phase 8. `apps/api/src/routes/creators.ts`'s zod schemas simply don't accept those fields yet.

### Creator page address

There is **no app-owned username or slug** anywhere in the system — the one public name is the AT Protocol handle, and the one durable internal key is the DID. A creator's page is `/c/<handle>` or `/c/<did>`; `/c/<did>` never breaks.

`GET /creators/:identifier` (`resolveCreatorByIdentifier` in `apps/api/src/services/creators.ts`) dispatches on shape: starts with `did:` → look up `Creator` by `did`; otherwise treat it as a handle (lowercased). Handle lookups resolve against the **locally cached** `User.handle` (a join, not a live `resolveHandle()` call) — deliberately, to keep a network dependency off this public read hot path before Phase 10's real indexing exists. A suspended creator (`Creator.status !== "ACTIVE"`) is invisible to this route, same as not existing.

**Handle changes and the redirect.** Handles are rented DNS names and can change. `syncUserFromProfile` (`packages/auth`) already overwrites `User.handle` from the PDS on every login; when it does so for a DID that has a `Creator` row, it first appends a `CreatorHandleHistory` row recording the *previous* handle (lowercased, plus the denormalized `did`). So when `resolveCreatorByIdentifier` finds no current match for a handle, it consults `CreatorHandleHistory`: if that handle was one this creator's DID previously published, the route returns **`301`** with `Location: /creators/<currentHandle>` and a JSON body `{ movedTo, did }` (so the non-redirect-following web SSR layer can act on it). Old `/c/<oldhandle>` links thus follow the DID to the current handle instead of 404ing. This piggybacks entirely on the existing login-time sync — no new network calls on any hot path; real-time/cross-session handle tracking is still Phase 10's job.

A handle can be freed and re-registered by a different DID over time, so several `CreatorHandleHistory` rows may share one `previousHandle`. Resolution walks them most-recent-`recordedAt` first and takes the first whose creator is still `ACTIVE` and whose *current* handle differs from the one looked up (a handle that has cycled back to the same DID is a live match, not a redirect).

## Subscription tiers live in packages/subscriptions, not apps/api

`creators.ts` (Phase 4) lives in `apps/api/src/services/` because there's no dedicated package for it in the target repo structure. Tiers are different: `prompts/full.md`'s target structure names `packages/subscriptions` explicitly for "tiers, billing, entitlements." The first Phase 5 draft put tier logic in `apps/api/src/services/tiers.ts` anyway (following the Phase 4 precedent too literally); this was corrected before merging, because it's not just a style inconsistency — **a package cannot depend on an app** in this monorepo's layering, so if `packages/subscriptions` ever needed the same "inject a fake AT-record writer for tests" shape `creators.ts` uses, it couldn't import it from `apps/api`. The fix: `PublishAtRecord`/`DeleteAtRecord`/`AtRecordPublishError`/`AtRecordDeleteError` moved to `packages/atproto/src/injection.ts` (a natural home — it's the DID-bound shape of `packages/atproto`'s own `putRecord`/`deleteRecord`), and the actual tier domain logic (`createTier`/`updateTier`/`deactivateTier`/`getOwnedTier`/`listActiveTiers`) lives in `packages/subscriptions/src/tiers.ts`. `apps/api/src/routes/tiers.ts` stays thin — HTTP parsing, zod validation, ownership lookup, error-to-status-code mapping — importing the domain logic from `@foryour-fans/subscriptions` like any other workspace package.

## Tiers: tid rkeys are generated once and reused, not regenerated per write

Unlike the creator profile record (`key: "literal:self"` — one fixed rkey, `"self"`, forever), `fans.foryour.tier` is `key: "tid"`: a creator can have many tiers, each its own record, and *we* choose the rkey (the PDS doesn't assign one). `SubscriptionTier.atRkey` stores the tid generated at creation time (`packages/atproto/src/records.ts#nextTid`, wrapping `@atproto/common-web`'s `TID.nextStr()`); every subsequent `PATCH` reuses that exact rkey via `putRecord`, and `DELETE` (deactivation) targets it via `deleteRecord`. Generating a fresh tid on update would silently orphan the old AT record instead of replacing it — `packages/subscriptions/src/tiers.test.ts` and `apps/api/test/tiers.test.ts`'s "republishes under the SAME rkey" test exist specifically to guard this.

A second difference from creators: **every** tier field a `PATCH` can touch (`name`, `description`, `priceCents`/`monthlyPrice`, `currency`, `sortOrder`) is part of the public AT record. So `updateTier` has no `hasProfileFields`-style optimization; any non-empty patch republishes the full merged record. An empty patch body still no-ops without a network call (checked explicitly), and `deactivateTier` checks `isActive` before calling `deleteAtRecord` at all, so calling `DELETE` on an already-inactive tier is idempotent by never attempting a second delete — see the doc comment on `packages/atproto/src/records.ts#deleteRecord` for why that's a real necessity, not defensive-programming reflex: whether deleting an already-absent AT record errors on a real PDS was never verified against the live network.

`GET /creators/:identifier/tiers` returns only `isActive: true` tiers, sorted by `sortOrder`, reusing Phase 4's `findActiveCreatorByIdentifier` — a tier's public listing and its creator's public visibility are gated the same way. Deactivated tiers are never deleted from Postgres (per `prompts/full.md`'s "existing subscriptions must retain historical tier information"), just hidden from this listing and stripped of their AT record.

## Payment/payout abstraction: a hosted-checkout shape, fakes everywhere

`packages/subscriptions/src/providers/types.ts` defines `PaymentProvider` and `PayoutProvider` exactly per `prompts/full.md`'s Phase 6 interface — `createCustomer`/`createSubscription`/`cancelSubscription`/`handleWebhook`, and `createCreatorAccount`/`getAccountStatus`. The one thing the spec left open is the *shape* of `createSubscription`'s result, and that shape was chosen deliberately: it supports returning a `redirectUrl` for a **hosted-checkout** flow (create a session, send the browser to the provider's page, get a webhook back) rather than assuming a processor can confirm a subscription synchronously. This isn't speculative — it's the integration model most high-risk/adult-content-compatible processors actually use (see prompts/full.md's Phase 6 content-policy note), and `prompts/web.md`'s `WEB PHASE 6` independently arrived at the same assumption ("the UI must assume a hosted-checkout redirect model... if it returns a redirect URL, send the browser there"), which is a good sign the shape is right.

`FakePaymentProvider`/`FakePayoutProvider` (`packages/subscriptions/src/providers/`) are **not test-only doubles** — they're the actual Phase 6 deliverable, wired into `apps/api/src/server.ts` as the real (only) implementation, per the spec's explicit instruction. `FakePaymentProvider.createSubscription` always returns `pending` + a fake redirect URL, never `active` synchronously — so the pending→webhook→active path is always exercised, in dev and in tests alike, rather than optimized away for convenience. A companion `fakeWebhookDelivery()` helper builds the raw bytes+headers a real delivery would look like, so tests exercise the exact same code path a real webhook would hit.

**Real money must never move through these.** The only gate that exists today is the doc comment on `server.ts` where they're instantiated; there's no code-level check, because there's nothing yet to check against — see `apps/api/src/routes/payouts.ts`'s doc comment on why payout onboarding is deliberately *not* gated on `Creator.verificationStatus` yet (that field has no way to become `VERIFIED` until Phase 14 exists; gating on it now would make Phase 6's own routes permanently unusable). When a real provider is introduced, gating *that* on verification status is the right enforcement point.

## Webhooks: idempotency ledger + a raw-body parsing detail that matters later

`PaymentEvent` (`[provider, providerEventId]` unique) is the idempotency ledger — `packages/subscriptions/src/webhooks.ts#processWebhookEvent` upserts a row before applying any side effect, and short-circuits with `"duplicate"` if a matching row already has `processedAt` set. A row that exists but has `processedAt: null` (a prior attempt crashed mid-processing) is retried, not skipped. Verified directly, not just asserted: `apps/api/test/subscriptions.test.ts`'s idempotency test replays the identical delivery and checks the Subscription row's `updatedAt` didn't move the second time, plus that exactly one `PaymentEvent` row exists.

`apps/api/src/routes/webhooks.ts` registers its own `addContentTypeParser` for `application/json`, scoped to just that route via the same Fastify-encapsulation trick `sessionPlugin` uses (see below) — it hands the handler the raw `Buffer` instead of letting Fastify's default parser JSON-parse-then-reserialize it. This doesn't matter for `FakePaymentProvider` (it does no signature verification), but it matters enormously for whatever real provider eventually replaces it: signature verification is computed over the exact bytes received, and a re-serialized JSON object is not guaranteed to produce identical bytes. Getting this right now, while it's free, avoids a webhook-verification outage the day a real processor gets wired in.

## Entitlements: `canAccess`, and the tier-hierarchy assumption it's built on

`packages/subscriptions/src/entitlements.ts#canAccess` is the single function every private-content route calls — `apps/api/src/routes/posts.ts#checkPostAccess` is its only caller today. Three decisions worth knowing about, all documented in its own doc comment too:

- A creator always has access to their own content — checked first, no query needed.
- Only `ACTIVE` subscriptions grant access; `PAST_DUE` does not. This is a conservative default (fail closed on a failed payment), not something the spec mandated either way.
- A `requiredTierId` check uses `SubscriptionTier.sortOrder` as a hierarchy, not an exact match — a subscriber on a higher-`sortOrder` tier can access content gated at a lower one. This was an *inferred* design decision going into Phase 6 (from `minimumTierId`'s name alone, read as "the minimum tier that grants access" — the conventional meaning on a tiered platform); Phase 7's `TIER`-visibility posts confirm it — `Post.minimumTierId` is passed straight through as `canAccess`'s `requiredTierId`, no translation layer needed, and `apps/api/test/posts.test.ts` exercises both directions (a lower-tier subscriber denied a higher-gated post; a matching-or-higher subscriber admitted).

## A real test-hygiene bug: cross-file handle collisions

`apps/api/test/creators.test.ts` and `apps/api/test/subscriptions.test.ts` both independently picked the literal handle `"liam.test"` for a test user. Vitest runs different test *files* in parallel by default, and `User.handle` has no database uniqueness constraint — it's a cache, not an identifier (see "Identity" above) — so nothing prevented two rows from transiently sharing a handle. `findActiveCreatorByIdentifier`'s handle lookup (`prisma.creator.findFirst`) has no deterministic tiebreak between them, so whichever row Postgres happened to return first made one of the two tests flake, nondeterministically — caught because a CI-style full-suite run failed on a test that passed cleanly every time it was run in isolation, a classic parallelism-bug signature.

Fixed at the root: `apps/api/test/helpers.ts#uniqueHandle(prefix)` generates a randomly-suffixed handle. `subscriptions.test.ts` (the file colliding with both `creators.test.ts` and `tiers.test.ts`) was converted to use it throughout. The other files' hand-picked literals were left as-is rather than retroactively converted — they don't collide with each other today, and the fix that matters going forward is behavioral: **new test files should use `uniqueHandle()`, not a hand-picked literal**, the same way randomly-generated DIDs already are. (The Handle-as-Identity refactor later made the handle the *only* public creator identifier — the former `uniqueSlug` helper and every `/creators/:slug` path are gone — which raises the stakes on this: cross-file handle collisions now also affect handle-based creator resolution.) A second, unrelated lesson from the same incident: a failed assertion mid-test skips every cleanup call written after it in that test body, which is how two orphaned `liam.test` rows ended up sitting in the dev database in the first place — a reason to keep test bodies short between setup and their first assertion, not a reason to add cleanup-in-`finally` everywhere (not done here, but worth knowing if this pattern recurs). `apps/api/test/posts.test.ts` used `uniqueHandle()` throughout from the start.

## Private content: ContentRepository is storage-only, entitlement lives outside it

`prompts/full.md`'s Phase 7 interface (`createPost`/`updatePost`/`deletePost`/`getPost`/`getCreatorFeed`) has no viewer/entitlement parameter anywhere in it, and `canAccess`'s own doc comment (written during Phase 6, before Phase 7 existed) already called this: "Phase 7's private-content routes will call this directly." So `packages/content`'s `ContentRepository` is deliberately pure storage — it has no idea a viewer or an entitlement check exists — and `apps/api/src/routes/posts.ts#checkPostAccess` is the one place that combines a fetched post with `canAccess` to decide what a specific caller gets to see. This split matters for Phase 11: swapping in `AtprotoSpacesContentRepository` must not require re-deriving or duplicating entitlement logic, because entitlement was never the storage layer's job to begin with.

`GET /creators/:creator/posts` applies that same `checkPostAccess` check per post and silently omits ones the caller can't see — it does **not** return locked-post placeholders. That's a deliberate scope boundary, not an oversight: `prompts/full.md`'s Phase 9 defines a *different* pair of routes (`GET /feed`, `GET /creators/:creator/feed`) specifically for the polished experience with "locked posts may return safe metadata... but never protected body/media data." Phase 7's `GET /creators/:creator/posts` existed before that concept did, so it stays simple.

## PUBLIC posts are the only visibility that ever touches the AT network

`Post.visibility` is `PUBLIC | SUBSCRIBERS | TIER`. Only `PUBLIC` posts get a mirrored `fans.foryour.post` AT record (`Post.atRkey`, generated once and reused across edits — same `nextTid()`-then-reuse pattern Phase 5 established for tiers); `SUBSCRIBERS`/`TIER` posts are Postgres-only, full stop, matching the "explicitly, permanently forbidden" list in `docs/atproto-vs-database.md`. This isn't left to routes to remember correctly — `PrivateContentRepository.createPost`/`updatePost` (`packages/content/src/repository.ts`) are the single choke point that decides whether to publish/retract, the same "one place, not every caller" instinct behind `checkPostAccess` above.

The interesting case is a visibility change that crosses the `PUBLIC` boundary in either direction (`updatePost`, exercised directly in `packages/content/src/repository.test.ts` since Phase 7 defines no HTTP route for it — see below): leaving `PUBLIC` retracts the AT record and clears `atRkey`; entering `PUBLIC` mints a fresh rkey and publishes; staying `PUBLIC` republishes under the *same* rkey (identical to a tier edit); staying off `PUBLIC` the whole time never touches the network at all, and the repository skips even looking up the creator's DID in that case, since it isn't needed.

**`updatePost` exists with no HTTP route.** `prompts/full.md`'s Phase 7 route list is exactly `POST /creators/me/posts`, `GET /creators/:creator/posts`, `GET /posts/:id`, `DELETE /creators/me/posts/:id` — no `PATCH`. The `ContentRepository` interface still specifies `updatePost` (for symmetry with create/delete/get, and because a future phase or a different route will presumably want it), so it's implemented and tested, just not wired to any endpoint yet.

## `PostMedia` exists now; nothing writes to it yet

`prompts/full.md` is explicit that `PostMedia` (`postId`, `mediaAssetId`, `sortOrder`) should be a join table, not an array column on `Post`, because Phase 8's `MediaAsset` is uploaded independently ("upload-then-attach") and one asset shouldn't be assumed to belong to exactly one post forever. Since `MediaAsset` doesn't exist yet, `PostMedia.mediaAssetId` is a bare `String @db.Uuid` column with no Prisma relation — there's nothing to relate to. No route in Phase 7 accepts a `media` field on create/update, on purpose: accepting arbitrary UUID-shaped strings before there's a real table to validate them against would let a client create orphaned join rows referencing assets that never existed. `PostRecord.media` is always `[]` until Phase 8 wires attachment.

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

Per the spec's phase discipline: media/blob uploads (so no creator avatar/banner yet, no tier images, and `Post.media` is always empty — `packages/media` remains an empty scaffold), the polished home/creator feed with locked-post preview metadata (Phase 9's `GET /feed`/`GET /creators/:creator/feed`, distinct from Phase 7's simpler `GET /creators/:creator/posts`), and a real payment/payout processor (Phase 6 explicitly builds the fake-only abstraction, not a processor integration).

## Known limitations

See the README's "Known limitations" section — kept there rather than duplicated here since it's the first thing a new contributor reads.

## Next phase

Phase 8 — Secure Media.
