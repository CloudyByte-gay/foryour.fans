# foryour.fans

An AT Protocol-native paid creator platform (Patreon/OnlyFans-inspired). Identity is a portable AT Protocol account (a DID) — there is no separate username/password system.

This repository is being built in phases; see [`prompts/full.md`](./prompts/full.md) for the full API spec (and [`prompts/web.md`](./prompts/web.md) for the web UI spec, once the API phases it depends on exist) and [`docs/build-plan.md`](./docs/build-plan.md) for the phase-by-phase tracking view. **This README reflects Phases 1–7 (Repository Foundation, AT Protocol Identity and OAuth, Custom AT Protocol Lexicons, Creator Accounts, Subscription Tiers, Subscription and Payment Abstraction, Private Content Architecture).**

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
  content/        ContentRepository interface, PrivateContentRepository (Postgres), AtprotoSpacesContentRepository stub
  media/          Secure media upload/access — Phase 8
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

# generate the Prisma client and apply migrations
pnpm db:generate
pnpm --filter @foryour-fans/database run migrate

# build workspace packages once (apps/api's compiled output imports the
# built dist/ of workspace packages, not their TypeScript source)
pnpm build

pnpm dev:api   # http://127.0.0.1:4000
pnpm dev:web   # http://127.0.0.1:3000
```

**Browse to `http://127.0.0.1:3000`, not `http://localhost:3000`.** AT Protocol's dev "loopback" OAuth client requires the redirect URI host to be exactly `127.0.0.1` — see docs/architecture.md. Using `localhost` will make login fail.

Verify the API is up:

```bash
curl http://127.0.0.1:4000/health   # liveness — process only
curl http://127.0.0.1:4000/ready    # readiness — verifies Postgres connectivity
```

Log in at `http://127.0.0.1:3000/login` with any real AT Protocol handle (e.g. an existing Bluesky handle) — this performs a real OAuth flow against that handle's real PDS/authorization server; there is no mock login. From `/dashboard`, follow "Become a creator" to publish a real `fans.foryour.profile` record to your own PDS and claim a slug (`/c/your-slug`), then use `POST /creators/me/tiers` to add subscription tiers. A second account can `POST /creators/:slug/subscribe` with a `tierId`; the fake payment provider returns a `redirectUrl` and the subscription stays `PENDING` until a matching delivery hits `POST /webhooks/fake` (see `apps/api/test/subscriptions.test.ts` for exact payload shapes). Once a creator has posted with `POST /creators/me/posts` (`visibility: "PUBLIC" | "SUBSCRIBERS" | "TIER"`, plus `minimumTierId` for `TIER`), `GET /posts/:id` and `GET /creators/:slug/posts` enforce entitlement via `canAccess` — a `PUBLIC` post is visible to anyone including anonymous requests, everything else needs an `ACTIVE` subscription at the right tier or higher — none of this has a web UI yet, see Known limitations.

## Commands

| Command | What it does |
|---|---|
| `pnpm build` | Builds every package/app in dependency order — **run this before lint/typecheck/test on a clean checkout** (see docs/architecture.md) |
| `pnpm lint` | ESLint across every workspace package |
| `pnpm typecheck` | `tsc --noEmit` across every workspace package |
| `pnpm test` | Vitest across every workspace package that has tests |
| `pnpm dev:api` / `pnpm dev:web` | Runs the API / web app in watch mode |

CI (`.github/workflows/ci.yml`) runs install → generate → migrate → **build** → lint → typecheck → test against real Postgres and Redis service containers on every PR.

## Known limitations (Phases 1–7)

- `packages/media` is still an empty scaffold (`export {}`) — Phase 8's job. `PostMedia` (the join table Phase 7 creates in anticipation of it) has no writer yet: no route accepts a `media` attachment on a post, and `mediaAssetId` is a bare column with no Prisma relation, because the `MediaAsset` model itself doesn't exist until Phase 8.
- `GET /creators/:creator/posts` (Phase 7) is a simple, unpaginated, always-full-body creator post list — it is NOT the polished home/creator feed with locked-post preview metadata that Phase 9 builds at different routes (`GET /feed`, `GET /creators/:creator/feed`). A viewer simply never sees a post they can't access; there's no "locked" teaser concept yet.
- `ContentRepository.updatePost` is fully implemented (including the PUBLIC-visibility-transition AT publish/retract logic — see `packages/content/src/repository.test.ts`) but has no HTTP route in Phase 7 — `prompts/full.md`'s Phase 7 route list only ever specifies `POST`/`GET`/`DELETE`, never a `PATCH`.
- `AtprotoSpacesContentRepository` (`packages/content/src/atprotoSpacesRepository.ts`) is an intentionally unimplemented stub per `prompts/full.md`'s Phase 7 instruction ("define, but DO NOT make production-dependent") — every method throws. Nothing in `apps/api` constructs or wires it; only `PrivateContentRepository` is ever instantiated (see `apps/api/src/server.ts`). Phase 11 is where it becomes real.
- Only a fake `PaymentProvider`/`PayoutProvider` exist — `prompts/full.md` is explicit that Phase 6 builds the abstraction, not a real processor integration. Real money must never move through `FakePaymentProvider`/`FakePayoutProvider`; see docs/architecture.md.
- No web UI for subscribing, managing subscriptions, or payout onboarding yet (`prompts/web.md`'s `WEB PHASE 6` covers this and hasn't been started) — same gap as Phase 5's tier management UI.
- Payout onboarding is intentionally *not* gated on `Creator.verificationStatus` — that field can't become `VERIFIED` until Phase 14 exists, so gating on it now would make the payout routes permanently unusable. See `apps/api/src/routes/payouts.ts`.
- `PaymentProvider` has no "resume/reactivate" method (matches `prompts/full.md`'s literal Phase 6 interface), so un-canceling a subscription (`cancelAtPeriodEnd: false` before the period ends) is local-state-only — nothing is told to the provider.
- `canAccess`'s tier-hierarchy behavior (a higher-`sortOrder` tier grants access to a lower-`sortOrder` requirement) is confirmed by Phase 7's `TIER`-visibility posts, which pass `minimumTierId` straight through as `requiredTierId` — see `apps/api/test/posts.test.ts`'s lower/higher-tier tests and docs/architecture.md.
- A creator's `avatar`/`banner` fields exist in the `fans.foryour.profile` Lexicon but aren't settable yet — that requires blob upload, which is Phase 8. Only `displayName`/`bio`/`website` are wired up.
- `GET /creators/:identifier` resolves a handle-shaped identifier against the **locally cached** `User.handle` (synced at login), not a live PDS lookup — see docs/architecture.md "Creator identifier resolution" for why. It can be briefly stale if a creator changes their AT handle and hasn't logged back in since; DID-based lookup is always current.
- Changing a creator's slug is rate-limited (once per 7 days) but a changed slug's *old* URL 404s immediately rather than redirecting — no slug-history/redirect table yet.
- If a creator's or tier's Lexicon-record publish to a PDS succeeds but the subsequent local DB write then fails (e.g. a slug-uniqueness race on `POST /creators`), the AT record is left in place with no local counterpart — a known, rare, uncorrected edge case.
- Whether deleting an already-nonexistent AT record errors on a real PDS has never been verified against the live network — tier deactivation guards against double-delete itself instead of relying on that (checks `isActive` before calling `deleteAtRecord`).
- A real, authenticated AT record write to a live PDS has still not been re-verified since Phase 2 (interactive user consent can't be automated in this environment) — every Lexicon-publishing route (creators, tiers, posts) is covered by tests using a fake AT-record publisher instead. 146 tests total across the workspace as of this phase.
- The Lexicon namespace is `fans.foryour` (reverse-DNS of the production domain `foryour.fans`), renamed from the `dev.creator` Phase 3 placeholder once the domain was chosen — see `packages/lexicons/src/nsids.ts`.
- The AT OAuth "hosted" (production) client mode is implemented (`ATPROTO_OAUTH_MODE=hosted`) but has not been exercised against a real deployment.
- `NodeOAuthClient`'s `requestLock` is a single in-process lock. This is only correct for one `apps/api` replica — Phase 16 (multi-replica Kubernetes) must swap it for a distributed lock before scaling horizontally.
- Session cookies are opaque random tokens looked up server-side in Redis, not signed JWTs — a deliberate simplification since the cookie carries no meaningful claims to forge.
- CSRF protection (double-submit cookie) covers every mutating route via the shared `requireCsrf` preHandler — any future mutating route must adopt the same helper.
- **Test-writing note for future phases:** use `apps/api/test/helpers.ts#uniqueHandle(prefix)` for fake AT handles in new tests, not a hand-picked literal like `"alice.test"` — vitest runs test files in parallel, and a real cross-file collision (`creators.test.ts` vs `subscriptions.test.ts`, both using `"liam.test"`) caused a genuinely flaky test during Phase 6 development. See docs/architecture.md for the full story.

## Next phase

Phase 8 — Secure Media (see `prompts/full.md`).
