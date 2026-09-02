# foryour.fans

An AT Protocol-native paid creator platform (Patreon/OnlyFans-inspired). Identity is a portable AT Protocol account (a DID) — there is no separate username/password system.

This repository is being built in phases; see [`prompts/full.md`](./prompts/full.md) for the full spec and [`docs/build-plan.md`](./docs/build-plan.md) for the phase-by-phase tracking view. **This README reflects Phases 1–4 (Repository Foundation, AT Protocol Identity and OAuth, Custom AT Protocol Lexicons, Creator Accounts).**

## Repository structure

```text
apps/
  api/            Fastify API
  web/            Next.js web app
packages/
  database/       Prisma schema + client (User, Creator, AtprotoOAuthSession)
  shared/         Cross-cutting types/utilities (Did type, Redis client factory)
  atproto/        Handle/DID/PDS resolution, AT OAuth client, generic record writes
  auth/           App session store, AT OAuth token stores, User upsert
  lexicons/       dev.creator.{profile,post,tier} Lexicons + generated types
  content/        Private content repository — Phase 7
  subscriptions/  Tiers, billing, entitlements — Phases 5–6
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

Log in at `http://127.0.0.1:3000/login` with any real AT Protocol handle (e.g. an existing Bluesky handle) — this performs a real OAuth flow against that handle's real PDS/authorization server; there is no mock login. From `/dashboard`, follow "Become a creator" to publish a real `dev.creator.profile` record to your own PDS and claim a slug (`/c/your-slug`).

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
  `app/(marketing)/c/[slug]/`, `app/(app)/creator/settings/`): a 4-step wizard
  (slug with client rules in `lib/slug.ts` + live availability via
  `GET /creators/:id`, profile, a *self-attested* content-rating placeholder,
  review → `POST /creators`); the public `/c/:slug` page (accepts handle / slug
  / DID, owner `Edit` affordance, `EmptyState`s for tiers/posts, disabled
  `Subscribe`); and a rebuilt `/creator/settings` with a guarded slug-change
  `Dialog` (7-day cooldown + "old links break" warning, `PATCH /creators/me`).
  **No API change this phase** — avatar/banner upload (no blob path, WEB
  PHASE 8) and content-rating persistence (no field, WEB PHASE 14) are
  documented placeholders.

### Web commands

| Command | What it does |
|---|---|
| `pnpm dev:web` | `next dev` (browse `http://127.0.0.1:3000`) |
| `pnpm --filter @foryour-fans/web lint` | ESLint (`--max-warnings=0`) over `app`, `components`, `lib` |
| `pnpm --filter @foryour-fans/web typecheck` | `tsc --noEmit` |
| `pnpm --filter @foryour-fans/web test` | Vitest + React Testing Library (jsdom) |
| `pnpm --filter @foryour-fans/web test:e2e` | Playwright auth round-trip (needs Postgres + Redis; starts a fake-OAuth API + a prod web build) |
| `pnpm --filter @foryour-fans/web build` | `next build` |

## Known limitations (Phases 1–4)

- `packages/content`, `subscriptions`, `media` are still empty scaffolds (`export {}`) — homes for later phases, not functional yet.
- No subscriptions or paid content yet.
- A creator's `avatar`/`banner` fields exist in the `dev.creator.profile` Lexicon but aren't settable yet — that requires blob upload, which is Phase 8. Only `displayName`/`bio`/`website` are wired up.
- `GET /creators/:identifier` resolves a handle-shaped identifier against the **locally cached** `User.handle` (synced at login), not a live PDS lookup — see docs/architecture.md "Creator identifier resolution" for why. It can be briefly stale if a creator changes their AT handle and hasn't logged back in since; DID-based lookup is always current.
- Changing a creator's slug is rate-limited (once per 7 days) but a changed slug's *old* URL 404s immediately rather than redirecting — no slug-history/redirect table yet. Revisit if this becomes a real problem once discovery/feeds (Phase 9/10) make stale links common.
- If a creator's Lexicon-record publish to their PDS succeeds but the subsequent local DB write then fails (e.g. a slug-uniqueness race on `POST /creators`), the AT record is left in place with no local counterpart — a known, rare, uncorrected edge case.
- The Lexicons (`packages/lexicons`) validation and generation are covered by 16 tests, and `dev.creator.profile` writes are now exercised by 15 creators-route tests (with a fake AT-record publisher) — but a real, authenticated write to a live PDS was **not** re-verified this phase (Phase 2's real-network verification covered the OAuth mechanics `publishAtRecord` builds on; completing a full write requires interactive user consent this environment can't automate). `packages/lexicons/src/lexicons/**` remains gitignored/regenerated by `pnpm build`.
- The AT OAuth "hosted" (production) client mode is implemented (`ATPROTO_OAUTH_MODE=hosted`) but has not been exercised against a real deployment.
- `NodeOAuthClient`'s `requestLock` is a single in-process lock (`requestLocalLock`). This is only correct for one `apps/api` replica — Phase 16 (multi-replica Kubernetes) must swap it for a distributed lock (e.g. Redlock over Redis) before scaling horizontally.
- Session cookies are opaque random tokens looked up server-side in Redis, not signed JWTs — a deliberate simplification (see docs/architecture.md) since the cookie carries no meaningful claims to forge.
- CSRF protection (double-submit cookie) now covers every mutating route (`POST /auth/logout`, `POST /creators`, `PATCH /creators/me`) via the shared `requireCsrf` preHandler — any future mutating route must adopt the same helper.
- `GET /auth/atproto/callback` redirects the browser to `<PUBLIC_URL>/auth/callback` after the token exchange (and to `…/auth/callback?error=<code>` on a cancelled/failed authorization) — the web app finishes routing from there (WEB PHASE 2). It previously redirected straight to `/dashboard` and returned a JSON `400` on failure.
- `POST /me/refresh` (`requireSession` + `requireCsrf`, added for WEB PHASE 3) re-pulls the caller's cached profile fields (`handle`/`displayName`/`avatarUrl`) from their PDS via `oauthClient.restore(did)` → `fetchProfile` → `syncUserFromProfile`, and returns the same shape as `GET /me`. `502` if the AT session can't be restored or the profile fetch fails; the DID is never modified.

## Next phase

Phase 5 — Subscription Tiers (see `prompts/full.md`).
