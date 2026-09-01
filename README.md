# foryour.fans

An AT Protocol-native paid creator platform (Patreon/OnlyFans-inspired). Identity is a portable AT Protocol account (a DID) — there is no separate username/password system.

This repository is being built in phases; see [`prompts/full.md`](./prompts/full.md) for the full API spec (and [`prompts/web.md`](./prompts/web.md) for the web UI spec, once the API phases it depends on exist) and [`docs/build-plan.md`](./docs/build-plan.md) for the phase-by-phase tracking view. **This README reflects Phases 1–5 (Repository Foundation, AT Protocol Identity and OAuth, Custom AT Protocol Lexicons, Creator Accounts, Subscription Tiers).**

## Repository structure

```text
apps/
  api/            Fastify API
  web/            Next.js web app
packages/
  database/       Prisma schema + client (User, Creator, SubscriptionTier, AtprotoOAuthSession)
  shared/         Cross-cutting types/utilities (Did type, Redis client factory)
  atproto/        Handle/DID/PDS resolution, AT OAuth client, generic record read/write/delete
  auth/           App session store, AT OAuth token stores, User upsert
  lexicons/       fans.foryour.{profile,post,tier} Lexicons + generated types
  subscriptions/  Subscription tier domain logic (CRUD, AT record sync)
  content/        Private content repository — Phase 7
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

Log in at `http://127.0.0.1:3000/login` with any real AT Protocol handle (e.g. an existing Bluesky handle) — this performs a real OAuth flow against that handle's real PDS/authorization server; there is no mock login. From `/dashboard`, follow "Become a creator" to publish a real `fans.foryour.profile` record to your own PDS and claim a slug (`/c/your-slug`), then use `POST /creators/me/tiers` to add subscription tiers (no dedicated tier-management page yet — see Known limitations).

## Commands

| Command | What it does |
|---|---|
| `pnpm build` | Builds every package/app in dependency order — **run this before lint/typecheck/test on a clean checkout** (see docs/architecture.md) |
| `pnpm lint` | ESLint across every workspace package |
| `pnpm typecheck` | `tsc --noEmit` across every workspace package |
| `pnpm test` | Vitest across every workspace package that has tests |
| `pnpm dev:api` / `pnpm dev:web` | Runs the API / web app in watch mode |

CI (`.github/workflows/ci.yml`) runs install → generate → migrate → **build** → lint → typecheck → test against real Postgres and Redis service containers on every PR.

## Known limitations (Phases 1–5)

- `packages/content`, `media` are still empty scaffolds (`export {}`) — homes for later phases, not functional yet.
- No payment processing yet — `prompts/full.md` is explicit that Phase 5 must not implement it. Tiers can be created/edited/deactivated, but nothing can actually be subscribed to until Phase 6.
- There's no `/creator/tiers` web page yet — tier management is API-only this phase (`prompts/web.md`'s `WEB PHASE 5` covers the UI and hasn't been started).
- A creator's `avatar`/`banner` fields exist in the `fans.foryour.profile` Lexicon but aren't settable yet — that requires blob upload, which is Phase 8. Only `displayName`/`bio`/`website` are wired up.
- `GET /creators/:identifier` resolves a handle-shaped identifier against the **locally cached** `User.handle` (synced at login), not a live PDS lookup — see docs/architecture.md "Creator identifier resolution" for why. It can be briefly stale if a creator changes their AT handle and hasn't logged back in since; DID-based lookup is always current.
- Changing a creator's slug is rate-limited (once per 7 days) but a changed slug's *old* URL 404s immediately rather than redirecting — no slug-history/redirect table yet. Revisit if this becomes a real problem once discovery/feeds (Phase 9/10) make stale links common.
- If a creator's or tier's Lexicon-record publish to a PDS succeeds but the subsequent local DB write then fails (e.g. a slug-uniqueness race on `POST /creators`), the AT record is left in place with no local counterpart — a known, rare, uncorrected edge case.
- Whether deleting an already-nonexistent AT record errors on a real PDS has never been verified against the live network — `packages/atproto`'s `deleteRecord` doesn't rely on it being a no-op; tier deactivation guards against double-delete itself instead (checks `isActive` before calling it).
- The Lexicons (`packages/lexicons`) validation/generation are covered by 16 tests, `fans.foryour.profile` writes by 15 creators-route tests, and `fans.foryour.tier` writes by 16 tiers-route tests plus 8 pure-validation unit tests in `packages/subscriptions` — all with a fake AT-record publisher. A real, authenticated write to a live PDS was **not** re-verified this phase (Phase 2's real-network verification covered the OAuth mechanics `publishAtRecord`/`deleteAtRecord` build on; completing a full write requires interactive user consent this environment can't automate). `packages/lexicons/src/lexicons/**` remains gitignored/regenerated by `pnpm build`.
- The Lexicon namespace is `fans.foryour` (reverse-DNS of the production domain `foryour.fans`) as of this phase — originally the `dev.creator` placeholder from Phase 3, renamed once the domain was chosen. Since no record was ever published under the placeholder, this was a zero-migration rename; see `packages/lexicons/src/nsids.ts`.
- The AT OAuth "hosted" (production) client mode is implemented (`ATPROTO_OAUTH_MODE=hosted`) but has not been exercised against a real deployment.
- `NodeOAuthClient`'s `requestLock` is a single in-process lock (`requestLocalLock`). This is only correct for one `apps/api` replica — Phase 16 (multi-replica Kubernetes) must swap it for a distributed lock (e.g. Redlock over Redis) before scaling horizontally.
- Session cookies are opaque random tokens looked up server-side in Redis, not signed JWTs — a deliberate simplification (see docs/architecture.md) since the cookie carries no meaningful claims to forge.
- CSRF protection (double-submit cookie) covers every mutating route (`POST /auth/logout`, `POST /creators`, `PATCH /creators/me`, `POST /creators/me/tiers`, `PATCH /creators/me/tiers/:id`, `DELETE /creators/me/tiers/:id`) via the shared `requireCsrf` preHandler — any future mutating route must adopt the same helper.

## Next phase

Phase 6 — Subscription and Payment Abstraction (see `prompts/full.md`).
