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

Log in at `http://127.0.0.1:3000/login` with any real AT Protocol handle (e.g. an existing Bluesky handle) — this performs a real OAuth flow against that handle's real PDS/authorization server; there is no mock login. From `/dashboard`, follow "Become a creator" to publish a real `fans.foryour.profile` record to your own PDS — your page is then `/c/<your-handle>` (and `/c/<your-did>`, which never breaks); there is no separate username to claim. Then use `POST /creators/me/tiers` to add subscription tiers. A second account can `POST /creators/<handle-or-did>/subscribe` with a `tierId`; the fake payment provider returns a `redirectUrl` and the subscription stays `PENDING` until a matching delivery hits `POST /webhooks/fake` (see `apps/api/test/subscriptions.test.ts` for exact payload shapes). Once a creator has posted with `POST /creators/me/posts` (`visibility: "PUBLIC" | "SUBSCRIBERS" | "TIER"`, plus `minimumTierId` for `TIER`), `GET /posts/:id` and `GET /creators/<handle-or-did>/posts` enforce entitlement via `canAccess` — a `PUBLIC` post is visible to anyone including anonymous requests, everything else needs an `ACTIVE` subscription at the right tier or higher — none of this has a web UI yet, see Known limitations.

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
state matrix. **This section reflects WEB PHASE 4 (design system & app shell,
marketing site, auth experience, `/settings`, and creator onboarding).**

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
  `EmptyState`s for tiers/posts, disabled `Subscribe`; a former handle
  `308`-redirects to the current one); and `/creator/settings` whose
  page-address card is a static note — the address follows your AT Protocol
  handle, changed via your PDS, and `/c/<did>` never changes. The
  Handle-as-Identity refactor removed the wizard's Slug step, `lib/slug.ts`,
  and the slug-change dialog. Avatar/banner upload (no blob path, WEB PHASE 8)
  and content-rating persistence (no field, WEB PHASE 14) are documented
  placeholders.

### Web commands

| Command | What it does |
|---|---|
| `pnpm dev:web` | `next dev` (browse `http://127.0.0.1:3000`) |
| `pnpm --filter @foryour-fans/web lint` | ESLint (`--max-warnings=0`) over `app`, `components`, `lib` |
| `pnpm --filter @foryour-fans/web typecheck` | `tsc --noEmit` |
| `pnpm --filter @foryour-fans/web test` | Vitest + React Testing Library (jsdom) |
| `pnpm --filter @foryour-fans/web test:e2e` | Playwright auth round-trip (needs Postgres + Redis; starts a fake-OAuth API + a prod web build) |
| `pnpm --filter @foryour-fans/web build` | `next build` |

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
- `GET /creators/:identifier` resolves a handle against the **locally cached** `User.handle` (synced at login), not a live PDS lookup — see docs/architecture.md "Creator page address" for why. It can be briefly stale if a creator changes their AT handle and hasn't logged back in since; `/c/<did>` lookup is always current.
- A changed handle's old `/c/<oldhandle>` link 301-redirects to the current handle (`{ movedTo, did }`), driven by `CreatorHandleHistory` rows the login-time profile sync appends. This only updates when the creator next signs in — real-time/cross-session handle tracking is still Phase 10.
- If a creator's or tier's Lexicon-record publish to a PDS succeeds but the subsequent local DB write then fails (e.g. a one-creator-per-user race on `POST /creators`), the AT record is left in place with no local counterpart — a known, rare, uncorrected edge case.
- Whether deleting an already-nonexistent AT record errors on a real PDS has never been verified against the live network — tier deactivation guards against double-delete itself instead of relying on that (checks `isActive` before calling `deleteAtRecord`).
- A real, authenticated AT record write to a live PDS has still not been re-verified since Phase 2 (interactive user consent can't be automated in this environment) — every Lexicon-publishing route (creators, tiers, posts) is covered by tests using a fake AT-record publisher instead. 146 tests total across the workspace as of this phase.
- The Lexicon namespace is `fans.foryour` (reverse-DNS of the production domain `foryour.fans`), renamed from the `dev.creator` Phase 3 placeholder once the domain was chosen — see `packages/lexicons/src/nsids.ts`.
- The AT OAuth "hosted" (production) client mode is implemented (`ATPROTO_OAUTH_MODE=hosted`) but has not been exercised against a real deployment.
- `NodeOAuthClient`'s `requestLock` is a single in-process lock. This is only correct for one `apps/api` replica — Phase 16 (multi-replica Kubernetes) must swap it for a distributed lock before scaling horizontally.
- Session cookies are opaque random tokens looked up server-side in Redis, not signed JWTs — a deliberate simplification since the cookie carries no meaningful claims to forge.
- CSRF protection (double-submit cookie) covers every mutating route via the shared `requireCsrf` preHandler — any future mutating route must adopt the same helper.
- **Test-writing note for future phases:** use `apps/api/test/helpers.ts#uniqueHandle(prefix)` for fake AT handles in new tests, not a hand-picked literal like `"alice.test"` — vitest runs test files in parallel, and a real cross-file collision (`creators.test.ts` vs `subscriptions.test.ts`, both using `"liam.test"`) caused a genuinely flaky test during Phase 6 development. See docs/architecture.md for the full story.
- `GET /auth/atproto/callback` redirects the browser to `<PUBLIC_URL>/auth/callback` after the token exchange (and to `…/auth/callback?error=<code>` on a cancelled/failed authorization) — the web app finishes routing from there (WEB PHASE 2). It previously redirected straight to `/dashboard` and returned a JSON `400` on failure.
- `POST /me/refresh` (`requireSession` + `requireCsrf`, added for WEB PHASE 3) re-pulls the caller's cached profile fields (`handle`/`displayName`/`avatarUrl`) from their PDS via `oauthClient.restore(did)` → `fetchProfile` → `syncUserFromProfile`, and returns the same shape as `GET /me`. `502` if the AT session can't be restored or the profile fetch fails; the DID is never modified.

## Next phase

Phase 8 — Secure Media (see `prompts/full.md`).
