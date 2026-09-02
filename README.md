# foryour.fans

An AT Protocol-native paid creator platform (Patreon/OnlyFans-inspired). Identity is a portable AT Protocol account (a DID) — there is no separate username/password system.

This repository is being built in phases; see [`prompts/full.md`](./prompts/full.md) for the full API spec (and [`prompts/web.md`](./prompts/web.md) for the web UI spec, once the API phases it depends on exist) and [`docs/build-plan.md`](./docs/build-plan.md) for the phase-by-phase tracking view. **This README reflects Phases 1–10 (Repository Foundation, AT Protocol Identity and OAuth, Custom AT Protocol Lexicons, Creator Accounts, Subscription Tiers, Subscription and Payment Abstraction, Private Content Architecture, Secure Media, Creator and Subscriber Feeds, AT Protocol Public Discovery).**

Two rearchitecture specs are slated to run before Phase 11: [`prompts/creator-owned-pds.md`](./prompts/creator-owned-pds.md) (creator content — profiles, tiers, posts, media, config — moves to the creator's own PDS; gated content is encrypted, with foryour.fans brokering entitlement and decryption-key grants; Postgres/S3 become caches) and [`prompts/bluesky-public-posts.md`](./prompts/bluesky-public-posts.md) (every `PUBLIC` post is dual-published as `app.bsky.feed.post` + `fans.foryour.post`). See [`docs/build-plan.md`](./docs/build-plan.md) → "Planned rearchitecture".

## Repository structure

```text
apps/
  api/            Fastify API
  web/            Next.js web app
packages/
  database/       Prisma schema + client (User, Creator, SubscriptionTier, Subscription,
                  PaymentEvent, PayoutAccount, AtprotoOAuthSession)
  shared/         Cross-cutting types/utilities (Did type, Redis client factory)
  atproto/        Handle/DID/PDS resolution, AT OAuth client, generic record read/write/delete,
                  PublishAtRecord/DeleteAtRecord injection types
  auth/           App session store, AT OAuth token stores, User upsert
  lexicons/       fans.foryour.{profile,post,tier} Lexicons + generated types
  subscriptions/  Tier CRUD, PaymentProvider/PayoutProvider + fakes, webhooks, entitlements (canAccess)
  content/        ContentRepository interface (create/update/delete/get/getCreatorFeed/getFeed),
                  PrivateContentRepository (Postgres), AtprotoSpacesContentRepository stub
  media/          ObjectStorage interface, S3ObjectStorage (real, MinIO/R2/GCS-compatible), MediaProcessor,
                  presigned upload/download flow, MediaAsset lifecycle
  discovery/      Jetstream v1 client (JetstreamIngestor), commit-event parser + indexer,
                  IndexedCreatorProfile/IndexedPost/IndexedTier read model, discover/search queries
infrastructure/
  docker/         docker-compose.yml for local Postgres/Redis/MinIO
docs/             architecture.md, build-plan.md, atproto-vs-database.md
```

## Prerequisites

- Node.js 20+ (developed against 22)
- pnpm (`corepack enable` will pick up the `packageManager` field, or `npm i -g pnpm`)
- Docker (for local Postgres/Redis/MinIO)

## Getting started

```bash
pnpm install
cp .env.example .env

# start local Postgres/Redis/MinIO
docker compose -f infrastructure/docker/docker-compose.yml up -d

# create the local MinIO bucket for media (not auto-created — see Phase 8)
docker exec foryour-fans-minio-1 mc alias set local http://localhost:9000 foryour_fans foryour_fans_dev
docker exec foryour-fans-minio-1 mc mb local/foryour-fans-dev --ignore-existing

# generate the Prisma client and apply migrations
pnpm db:generate
pnpm --filter @foryour-fans/database run migrate

# build workspace packages once (apps/api's compiled output imports the
# built dist/ of workspace packages, not their TypeScript source)
pnpm build

pnpm dev:api   # http://127.0.0.1:4000
pnpm dev:web   # http://127.0.0.1:3000

# optional — a separate, long-lived process (see Phase 10): connects to a
# real public Jetstream server and indexes fans.foryour.* activity into
# /discover and /search. Not required for anything else to work.
pnpm --filter @foryour-fans/api dev:ingest
```

**Browse to `http://127.0.0.1:3000`, not `http://localhost:3000`.** AT Protocol's dev "loopback" OAuth client requires the redirect URI host to be exactly `127.0.0.1` — see docs/architecture.md. Using `localhost` will make login fail.

Verify the API is up:

```bash
curl http://127.0.0.1:4000/health   # liveness — process only
curl http://127.0.0.1:4000/ready    # readiness — verifies Postgres connectivity
```

Log in at `http://127.0.0.1:3000/login` with any real AT Protocol handle (e.g. an existing Bluesky handle) — this performs a real OAuth flow against that handle's real PDS/authorization server; there is no mock login. From `/dashboard`, follow "Become a creator" to publish a real `fans.foryour.profile` record to your own PDS — your page is then `/c/<your-handle>` (and `/c/<your-did>`, which never breaks); there is no separate username to claim. Then use `POST /creators/me/tiers` to add subscription tiers. A second account can `POST /creators/<handle-or-did>/subscribe` with a `tierId`; the fake payment provider returns a `redirectUrl` and the subscription stays `PENDING` until a matching delivery hits `POST /webhooks/fake` (see `apps/api/test/subscriptions.test.ts` for exact payload shapes). Once a creator has posted with `POST /creators/me/posts` (`visibility: "PUBLIC" | "SUBSCRIBERS" | "TIER"`, plus `minimumTierId` for `TIER`), `GET /posts/:id` and `GET /creators/<handle-or-did>/posts` enforce entitlement via `canAccess` — a `PUBLIC` post is visible to anyone including anonymous requests, everything else needs an `ACTIVE` subscription at the right tier or higher. A creator can also `POST /media/upload-url` (`{mimeType, size}`) to get a presigned URL, `PUT` bytes to it directly (no app server in the middle), then `POST /media/:id/complete` to finalize it; any other viewer's `GET /media/:id/access` is entitlement-checked exactly like a `SUBSCRIBERS` post (any active subscription, at any tier) and returns a short-lived signed download URL. `GET /feed` (optionally authenticated) returns every `PUBLIC` post platform-wide plus, for a logged-in caller, any `SUBSCRIBERS`/`TIER` post their active subscriptions actually unlock — `?limit=` bounded, newest first. `GET /creators/<handle-or-did>/feed` is the per-creator version: every one of that creator's posts, cursor-paginated (`?limit=&cursor=`), with a post the caller can't see returned as a safe `{id, visibility, createdAt, requiredTier, locked: true}` stub instead of being omitted. `GET /discover` (`?limit=&cursor=`) and `GET /search?q=` (matches handle/displayName/bio) browse the AT-network discovery index — populated by running `pnpm --filter @foryour-fans/api dev:ingest` separately, which connects to a real public Jetstream server and indexes any DID's `fans.foryour.profile`/`post`/`tier` records, not just ones that have signed in here — none of this has a web UI yet, see Known limitations.

## Commands

| Command | What it does |
|---|---|
| `pnpm build` | Builds every package/app in dependency order — **run this before lint/typecheck/test on a clean checkout** (see docs/architecture.md) |
| `pnpm lint` | ESLint across every workspace package |
| `pnpm typecheck` | `tsc --noEmit` across every workspace package |
| `pnpm test` | Vitest across every workspace package that has tests |
| `pnpm dev:api` / `pnpm dev:web` | Runs the API / web app in watch mode |

CI (`.github/workflows/ci.yml`) runs install → generate → migrate → **build** → lint → typecheck → test against real Postgres and Redis service containers on every PR.

## Web app (`apps/web`)

Built phase-by-phase from [`prompts/web.md`](./prompts/web.md); see
[`docs/ux.md`](./docs/ux.md) for the living screen inventory and auth/role
state matrix. **This section reflects WEB PHASE 5 (design system & app shell,
marketing site, auth experience, `/settings`, creator onboarding, and tier
management).**

- **Styling**: Tailwind CSS with CSS-variable design tokens
  (`app/globals.css` → `tailwind.config.ts`), class-strategy dark mode. Theme
  follows the OS by default; an explicit override lives in the `ff_theme`
  cookie and is applied during SSR (`lib/theme.server.ts`) plus a pre-paint
  inline script, so there is no flash.
- **Fonts**: Inter (body) + Sora (display), self-hosted via `next/font`.
- **UI primitives**: `apps/web/components/ui/` — Button, Input, Textarea,
  Select, Switch, Checkbox, Label, FormField, Card, Avatar, Badge, Dialog,
  DropdownMenu, Tabs, Tooltip, Toast (+ `toast()`), Skeleton, Spinner,
  EmptyState, ErrorState, InfiniteList. Radix primitives wrapped locally; no
  `packages/ui` workspace until a second consumer exists.
- **Shell**: `app/(marketing)/` (public, own layout) and `app/(app)/`
  (authenticated, redirects anon to `/login?next=`). The session is resolved
  on the server (`lib/session.ts`, `cache()`-deduped) and passed to `Header`,
  which renders the logged-out / logged-in variants with no flicker.
  `SessionProvider` exposes `{ status, user }` to client components, hydrated
  from the server value.
- **Errors**: global `app/error.tsx` and a refreshed `app/not-found.tsx`.
- **Client data**: TanStack Query provider is mounted in `Providers`; no
  queries yet.
- **Dev reference**: `/dev/components` renders every primitive in both themes.
  It `notFound()`s in a production build.
- **Marketing site** (`app/(marketing)/`): `/` (logged-out hero + explainer
  sections + `Featured creators` `EmptyState`; logged-in personalized panel,
  no redirect), `/about`, `/terms` · `/privacy` · `/legal/compliance`
  (placeholder copy, visible "pending legal review" note, `noindex`),
  `/discover` teaser. SEO via per-route `metadata`, `app/robots.ts`,
  `app/sitemap.ts`, and a text-only `app/opengraph-image.tsx` (no user or NSFW
  imagery in any preview asset). Base URL from `NEXT_PUBLIC_SITE_URL`
  (`lib/site.ts`).
- **Auth UX**: `/login` (handle-shape validation, specific start-error copy,
  loading state, stores a safe `next` in `sessionStorage`); `/auth/callback`
  ("Finishing sign-in…" → routes new vs returning users, honors `next`, shows
  friendly copy for a cancelled/failed authorization); shared `logout()`
  (`lib/auth.ts`) clears the session context and returns to `/`;
  `lib/apiFetch.ts` bounces client `/api/*` `401`s to `/login?next=` with a
  toast. `lib/nav.ts#isSafeInternalPath` guards every `next` against open
  redirects.
  - **API touch (WEB PHASE 2):** `GET /auth/atproto/callback` now 302s to
    `<PUBLIC_URL>/auth/callback` (success) or `…/auth/callback?error=<code>`
    (cancel / exchange failure) instead of `/dashboard` + a JSON 400. Cookies
    and session semantics are unchanged; `apps/api` tests updated.
- **Settings** (`app/(app)/settings/`): tabs `Account` / `Appearance` /
  `Notifications` (`?tab=` deep-links). Account shows the profile fields tagged
  "cached from AT Protocol" vs the DID tagged immutable (with a `CopyButton`),
  and a **Refresh from AT Protocol** action. Appearance is the theme control
  (system/light/dark → `ff_theme`, applied live). Notifications is a disabled
  preview of planned channels.
  - **API touch (WEB PHASE 3):** new `POST /me/refresh` (`requireSession` +
    `requireCsrf`) re-pulls the cached profile fields from the user's PDS
    (`restore` → `fetchProfile` → `syncUserFromProfile`), returning the updated
    `/me` shape. The DID is never touched.
- **Creator onboarding** (`app/(app)/become-a-creator/`,
  `app/(marketing)/c/[handle]/`, `app/(app)/creator/settings/`): a 3-step wizard
  (profile, a *self-attested* content-rating placeholder, review →
  `POST /creators` with profile fields only); the public `/c/[handle]` page
  (segment is an AT handle or a URL-encoded DID; owner `Edit` affordance,
  public tier cards from `GET /creators/:identifier/tiers` with a disabled
  `Subscribe`, `EmptyState` for posts; a former handle `308`-redirects to the
  current one); and `/creator/settings` whose
  page-address card is a static note — the address follows your AT Protocol
  handle, changed via your PDS, and `/c/<did>` never changes. The
  Handle-as-Identity refactor removed the wizard's Slug step, `lib/slug.ts`,
  and the slug-change dialog. Avatar/banner upload (no blob path, WEB PHASE 8)
  and content-rating persistence (no field, WEB PHASE 14) are documented
  placeholders.
- **Tier management** (`app/(app)/creator/tiers/`): a `/creator/tiers` page
  (ownership-gated like `/creator/settings` — a non-creator is redirected to
  `/become-a-creator`) listing the creator's tiers with drag-to-reorder
  (`@dnd-kit`, keyboard-operable), a per-row active/inactive `Switch`, and a
  create/edit `Dialog` (name, description, price in major units → minor,
  currency). Deactivating pops a "deactivated, not deleted — existing
  subscribers keep access" confirmation; editing a price shows the
  grandfathering callout. `lib/tier.ts` mirrors the API's tier body schema and
  holds the currency-aware money helpers. Public tier cards render on
  `/c/[handle]` (`components/creator/TierCard.tsx`); `Subscribe` stays disabled
  until WEB PHASE 6.
  - **API touch (WEB PHASE 5):** new `GET /creators/me/tiers` (`requireSession`)
    returns the caller's tiers **including deactivated ones** (the public
    `GET /creators/:identifier/tiers` is active-only), and new
    `POST /creators/me/tiers/:tierId/reactivate` (`requireSession` +
    `requireCsrf`) re-publishes a deactivated tier's `fans.foryour.tier` record
    and flips `isActive` back on — the inverse of `DELETE`. `apps/api` and
    `packages/subscriptions` tests added.

### Web commands

| Command | What it does |
|---|---|
| `pnpm dev:web` | `next dev` (browse `http://127.0.0.1:3000`) |
| `pnpm --filter @foryour-fans/web lint` | ESLint (`--max-warnings=0`) over `app`, `components`, `lib` |
| `pnpm --filter @foryour-fans/web typecheck` | `tsc --noEmit` |
| `pnpm --filter @foryour-fans/web test` | Vitest + React Testing Library (jsdom) |
| `pnpm --filter @foryour-fans/web test:e2e` | Playwright auth round-trip (needs Postgres + Redis; starts a fake-OAuth API + a prod web build) |
| `pnpm --filter @foryour-fans/web build` | `next build` |

## Known limitations (Phases 1–10)

- **Doc-based research pointed at the wrong Jetstream wire format; live verification caught it.** Initial research (fetching bsky.network's docs) described a "v2" envelope shape (`{$type: "message", payload: {...}}`) as "recommended for new projects" — but connecting directly to the real production endpoint (`wss://jetstream.us-east.bsky.network/subscribe`) showed it actually serves the flat v1 shape (`{did, time_us, cursor, kind: "commit", commit: {...}}`), and the query param is `wantedCollections`, not `collections`. `packages/discovery/src/jetstreamTypes.ts` and `ingestor.ts` are built against the verified-real format; see docs/architecture.md's Phase 10 section for the full verification transcript. This is exactly the class of gap `prompts/full.md`'s "research current recommended AT Protocol mechanisms before implementing" instruction exists to catch — and why a live check, not just a doc fetch, mattered here.
- Jetstream's `identity` event kind (network-wide handle-change notifications) is deliberately NOT subscribed to — see docs/architecture.md for the bandwidth/scoping tradeoff. `IndexedCreatorProfile.handle` is refreshed only when a `fans.foryour.profile`/`post`/`tier` commit for that DID is observed (each triggers a live `resolveDid` call), not proactively — it can go stale between a creator's own commits, mirroring the same kind of staleness `CreatorHandleHistory` already accepts for `User.handle`.
- The discovery index (`IndexedCreatorProfile`/`IndexedPost`/`IndexedTier`) can include a DID that has never signed in to this app at all — any DID publishing `fans.foryour.*` records is indexed, which is the intended behavior for an AT-network-wide discovery surface, not a bug. Visiting `/c/<handle>` for such a DID still 404s today (`findActiveCreatorByIdentifier` only knows the local `Creator` table) — `isRegisteredCreator` on each `/discover`/`/search` result at least lets a client avoid presenting a dead-end `Subscribe` button for one.
- `searchCreators` is plain case-insensitive `contains` matching across `handle`/`displayName`/`bio` — not full-text or trigram search, no relevance ranking. A reasonable starting point per `prompts/full.md`'s literal "search by: creator name, handle, bio," not a claim of search quality.
- The Jetstream ingestion consumer (`apps/api/src/ingest.ts`) is a separate long-lived process from the HTTP server (`server.ts`) — on purpose, so N horizontally-scaled API replicas (Phase 16) don't each independently re-consume the same firehose and race to write the same index. It has no Kubernetes manifest of its own yet (Phase 16 doesn't exist yet either) — a known, deliberate gap, not an oversight.
- A restarted ingestion process resumes from the last-persisted cursor (`IngestionCursor`, keyed on `time_us`) — but an *abandoned* `POST /media/upload-url` has an equivalent-shaped gap on the media side (see below); neither this project's ingestion cursor nor its media uploads have a garbage-collection story yet for the "started but never finished" case.
- **A real, previously-undetected cross-file test race, found and fixed during Phase 10 development**: three new `packages/discovery` test files share the `indexed_creator_profiles` table, and two of them originally used a blanket `afterEach(() => prisma.indexedCreatorProfile.deleteMany({}))` — since vitest runs test files in parallel, one file's `afterEach` could wipe rows a *different*, concurrently-running file's test hadn't finished asserting on yet. Same category of bug as Phase 6's handle-collision flake, just via deletion instead of creation this time. Fixed by scoping every cleanup to the specific `did`(s) each test created, never a blanket wipe — see `packages/discovery/src/indexer.test.ts`'s `cleanup()` doc comment, and follow the same rule for any future test file touching a table another test file also touches.

- `PostMedia` (the join table Phase 7 created in anticipation of Phase 8) still has no writer — no route attaches a `MediaAsset` to a `Post`. `GET /media/:id/access`'s entitlement check is therefore NOT "can you see the post this is attached to" (nothing associates the two yet); it's "does the media's own creator have you as an active subscriber, at any tier" — the same default a `SUBSCRIBERS`-visibility post uses. This is an inferred design decision (Phase 8's spec text doesn't state it explicitly), documented in docs/architecture.md. `PostMedia.mediaAssetId` does now have a real FK to `MediaAsset` (fixed from Phase 7's bare-UUID column), even though nothing writes to the table yet.
- `packages/media`'s real, shipped `MediaProcessor` (`PassthroughMediaProcessor`) does no actual scanning — it always marks an upload `READY`. `prompts/full.md`'s Phase 8 note is explicit that this is correct for now ("do not build full transcoding infrastructure unless necessary yet"); real virus/moderation scanning is Phase 14's job, plugging into the exact same `PENDING_UPLOAD → PROCESSING → READY/REJECTED` state machine with zero schema change.
- An abandoned upload (a client calls `POST /media/upload-url` but never `PUT`s bytes, or never calls `/complete`) leaves an orphaned `PENDING_UPLOAD` row and reserved storage key forever — nothing garbage-collects it. Not a data-integrity risk (nothing reads a non-`READY` asset), just wasted rows/storage.
- `GET /creators/:creator/posts` (Phase 7) still exists unchanged, alongside the new `GET /creators/:creator/feed` (Phase 9) — they're deliberately different: `/posts` is simple, unpaginated, and silently omits posts the caller can't see; `/feed` is cursor-paginated and returns every post, downgrading an inaccessible one to a safe locked stub instead of omitting it. Both are real, live routes; nothing deprecates `/posts`.
- There is no `Follow` model anywhere in `prompts/full.md`'s 17 phases, so `GET /feed`'s "public posts from followed/discovered creators" (the spec's literal phrase) collapses to "every `PUBLIC` post platform-wide" — `PUBLIC` already means visible to anyone, so there's no relationship left to gate that half on. Documented as an inferred reading in docs/architecture.md, not a guess left silent.
- `GET /feed` has no cursor — only `?limit=` (default 20, max 100), newest-first. Adding real cursor pagination there hit real complexity Phase 9's own spec text doesn't ask for (filtering by `canAccess` *after* fetching a page across many creators can legitimately return fewer than `limit` accessible posts even though more exist further down); the route over-fetches a fixed pad (20 extra candidates) as a pragmatic partial mitigation, not a strict guarantee. `GET /creators/:creator/feed` has real, correct cursor pagination instead, since it never drops a row — an inaccessible post becomes a locked stub, not an omission, so nothing is filtered out of an already-fetched page.
- `GET /creators/:creator/feed`'s cursor contract is the simple "always return a `nextCursor`, stop paging on an empty page" shape (not a peek-ahead "is there really more" check) — one extra empty round trip at the very end is expected, not a bug.
- A rare (~1 in 23 observed), unreproduced test flake surfaced once during Phase 8 development: `subscriptions.test.ts`'s idempotency test failed a `createTierFor` helper call during a full `pnpm test` (all workspace packages running concurrently) but passed cleanly in 22 subsequent full-suite runs and 12 apps/api-only runs. Active Postgres connections peaked at 6-7 during a monitored run (well under the 100-connection limit), so straightforward pool exhaustion doesn't explain it. Documented rather than silently ignored per this project's convention, but NOT treated as a confirmed root-caused bug — if it recurs with more frequency or a captured stack trace, it needs real investigation, not another guess.
- `ContentRepository.updatePost` is fully implemented (including the PUBLIC-visibility-transition AT publish/retract logic — see `packages/content/src/repository.test.ts`) but has no HTTP route in Phase 7 — `prompts/full.md`'s Phase 7 route list only ever specifies `POST`/`GET`/`DELETE`, never a `PATCH`.
- `AtprotoSpacesContentRepository` (`packages/content/src/atprotoSpacesRepository.ts`) is an intentionally unimplemented stub per `prompts/full.md`'s Phase 7 instruction ("define, but DO NOT make production-dependent") — every method throws. Nothing in `apps/api` constructs or wires it; only `PrivateContentRepository` is ever instantiated (see `apps/api/src/server.ts`). Phase 11 is where it becomes real.
- Only a fake `PaymentProvider`/`PayoutProvider` exist — `prompts/full.md` is explicit that Phase 6 builds the abstraction, not a real processor integration. Real money must never move through `FakePaymentProvider`/`FakePayoutProvider`; see docs/architecture.md.
- No web UI for subscribing, managing subscriptions, or payout onboarding yet (`prompts/web.md`'s `WEB PHASE 6` covers this and hasn't been started) — same gap as Phase 5's tier management UI.
- Payout onboarding is intentionally *not* gated on `Creator.verificationStatus` — that field can't become `VERIFIED` until Phase 14 exists, so gating on it now would make the payout routes permanently unusable. See `apps/api/src/routes/payouts.ts`.
- `PaymentProvider` has no "resume/reactivate" method (matches `prompts/full.md`'s literal Phase 6 interface), so un-canceling a subscription (`cancelAtPeriodEnd: false` before the period ends) is local-state-only — nothing is told to the provider.
- `canAccess`'s tier-hierarchy behavior (a higher-`sortOrder` tier grants access to a lower-`sortOrder` requirement) is confirmed by Phase 7's `TIER`-visibility posts, which pass `minimumTierId` straight through as `requiredTierId` — see `apps/api/test/posts.test.ts`'s lower/higher-tier tests and docs/architecture.md.
- Creator pages use cached Bluesky `avatar`/`banner` URLs by default. `Creator.avatarUrl`/`bannerUrl` are site-only overrides for foryour.fans profile images and are never written back to the user's PDS. The `avatar`/`banner` blob fields in the public `fans.foryour.profile` Lexicon still aren't wired because public AT blob upload (`com.atproto.repo.uploadBlob`) is a different, still-unbuilt mechanism from Phase 8's private media storage.
- `GET /creators/:identifier` resolves a handle against the **locally cached** `User.handle` (synced at login), not a live PDS lookup — see docs/architecture.md "Creator page address" for why. It can be briefly stale if a creator changes their AT handle and hasn't logged back in since; `/c/<did>` lookup is always current.
- A changed handle's old `/c/<oldhandle>` link 301-redirects to the current handle (`{ movedTo, did }`), driven by `CreatorHandleHistory` rows the login-time profile sync appends. This only updates when the creator next signs in.
- If a creator's or tier's Lexicon-record publish to a PDS succeeds but the subsequent local DB write then fails (e.g. a one-creator-per-user race on `POST /creators`), the AT record is left in place with no local counterpart — a known, rare, uncorrected edge case.
- Whether deleting an already-nonexistent AT record errors on a real PDS has never been verified against the live network — tier deactivation guards against double-delete itself instead of relying on that (checks `isActive` before calling `deleteAtRecord`).
- A real, authenticated AT record write to a live PDS has still not been re-verified since Phase 2 (interactive user consent can't be automated in this environment) — every Lexicon-publishing route (creators, tiers, posts) is covered by tests using a fake AT-record publisher instead. 294 tests total across the workspace as of this phase. Unlike AT writes, Phase 8's S3-compatible storage integration and Phase 10's Jetstream ingestion were both verified against real, live backends (a real MinIO container; a real production Jetstream server and a real `JetstreamIngestor` connecting to it) — since neither has Phase 2's "requires an external account and interactive consent" blocker.
- The Lexicon namespace is `fans.foryour` (reverse-DNS of the production domain `foryour.fans`), renamed from the `dev.creator` Phase 3 placeholder once the domain was chosen — see `packages/lexicons/src/nsids.ts`.
- The AT OAuth "hosted" (production) client mode is implemented (`ATPROTO_OAUTH_MODE=hosted`) but has not been exercised against a real deployment.
- `NodeOAuthClient`'s `requestLock` is a single in-process lock. This is only correct for one `apps/api` replica — Phase 16 (multi-replica Kubernetes) must swap it for a distributed lock before scaling horizontally.
- Session cookies are opaque random tokens looked up server-side in Redis, not signed JWTs — a deliberate simplification since the cookie carries no meaningful claims to forge.
- CSRF protection (double-submit cookie) covers every mutating route via the shared `requireCsrf` preHandler — any future mutating route must adopt the same helper.
- **Test-writing note for future phases:** use `apps/api/test/helpers.ts#uniqueHandle(prefix)` for fake AT handles in new tests, not a hand-picked literal like `"alice.test"` — vitest runs test files in parallel, and a real cross-file collision (`creators.test.ts` vs `subscriptions.test.ts`, both using `"liam.test"`) caused a genuinely flaky test during Phase 6 development. See docs/architecture.md for the full story.
- **`apps/api/test/**` is now actually type-checked** — a real, previously-undetected gap found during Phase 8: `apps/api`'s `pnpm typecheck` (`tsc -p tsconfig.json`) only ever covered `src`, since `tsconfig.json`'s `include` never listed `test`, and there was no error-until-Phase-8 to reveal it. Fixed with a second config, `apps/api/tsconfig.typecheck.json` (`include: ["src", "test"]`, `noEmit`, separate `rootDir`), now what `pnpm typecheck` actually runs — `apps/api/tsconfig.json` (the one `pnpm build` uses) is untouched, so compiled `dist/` output still never includes test files. See docs/architecture.md.
- `GET /auth/atproto/callback` redirects the browser to `<PUBLIC_URL>/auth/callback` after the token exchange (and to `…/auth/callback?error=<code>` on a cancelled/failed authorization) — the web app finishes routing from there (WEB PHASE 2). It previously redirected straight to `/dashboard` and returned a JSON `400` on failure.
- `POST /me/refresh` (`requireSession` + `requireCsrf`, added for WEB PHASE 3) re-pulls the caller's cached profile fields (`handle`/`displayName`/`avatarUrl`/`bannerUrl`) from their PDS via `oauthClient.restore(did)` → `fetchProfile` → `syncUserFromProfile`, and returns the same shape as `GET /me`. `502` if the AT session can't be restored or the profile fetch fails; the DID is never modified.

## Next phase

Two rearchitecture phases are specced to run before Phase 11 (see [`docs/build-plan.md`](./docs/build-plan.md) → "Planned rearchitecture"):

1. **Creator-owned PDS storage** ([`prompts/creator-owned-pds.md`](./prompts/creator-owned-pds.md)) — creator profiles, tiers, posts, media, and config move to the creator's own PDS; gated content is encrypted, with foryour.fans brokering entitlement and decryption-key grants. Postgres/S3 become caches and rebuildable indexes.
2. **Bluesky-compatible public posts** ([`prompts/bluesky-public-posts.md`](./prompts/bluesky-public-posts.md)) — every `PUBLIC` post is dual-published to the creator's PDS as `app.bsky.feed.post` + `fans.foryour.post`; feeds and discovery merge the pair into one item.

Order is confirmed: creator-owned PDS first (it redraws the lexicon shape dual-publish then builds on), then Bluesky-compatible public posts, then the remaining Phase 11+ work. (If the PDS pivot's privacy review stalls, `bluesky-public-posts.md` can still ship on its own.)

Then Phase 11 — AT Protocol Spaces Experimental Adapter (see `prompts/full.md`) — reframed by the specs above from "the private-content storage backend" to, at most, a key-grant / permission transport layered over encrypted creator-owned storage.
