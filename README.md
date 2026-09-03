# foryour.fans

An AT Protocol-native paid creator platform (Patreon/OnlyFans-inspired). Identity is a portable AT Protocol account (a DID) — there is no separate username/password system.

This repository is being built in phases; see [`prompts/full.md`](./prompts/full.md) for the full API spec (and [`prompts/web.md`](./prompts/web.md) for the web UI spec, once the API phases it depends on exist) and [`docs/build-plan.md`](./docs/build-plan.md) for the phase-by-phase tracking view. **This README reflects Phases 1–10 (Repository Foundation, AT Protocol Identity and OAuth, Custom AT Protocol Lexicons, Creator Accounts, Subscription Tiers, Subscription and Payment Abstraction, Private Content Architecture, Secure Media, Creator and Subscriber Feeds, AT Protocol Public Discovery), the two post-Phase-10 rearchitecture specs (creator-owned PDS storage — backend proof-of-concept, paused for privacy review; Bluesky-compatible public posts — implemented), and Phase 12 (Comments, Likes, and Social Interaction).**

The old Phase 11 slot (AT Protocol Spaces) is vacant — extracted to [`prompts/atproto-spaces.md`](./prompts/atproto-spaces.md), which runs dead last, after Phase 17. See [`docs/build-plan.md`](./docs/build-plan.md) → "Planned rearchitecture" and "Next phase" below.

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
                  PrivateContentRepository (Postgres), AtprotoSpacesContentRepository stub,
                  Comment/Like helpers (Phase 12 — Postgres-only, never mirrored to AT Protocol)
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

Log in at `http://127.0.0.1:3000/login` with any real AT Protocol handle (e.g. an existing Bluesky handle) — this performs a real OAuth flow against that handle's real PDS/authorization server; there is no mock login. From `/dashboard`, follow "Become a creator" to publish a real `fans.foryour.profile` record to your own PDS — your page is then `/c/<your-handle>` (and `/c/<your-did>`, which never breaks); there is no separate username to claim. Then use `POST /creators/me/tiers` to add subscription tiers. A second account can `POST /creators/<handle-or-did>/subscribe` with a `tierId`; the fake payment provider returns a `redirectUrl` and the subscription stays `PENDING` until a matching delivery hits `POST /webhooks/fake` (see `apps/api/test/subscriptions.test.ts` for exact payload shapes). Once a creator has posted with `POST /creators/me/posts` (`visibility: "PUBLIC" | "SUBSCRIBERS" | "TIER"`, plus `minimumTierId` for `TIER`), `GET /posts/:id` and `GET /creators/<handle-or-did>/posts` enforce entitlement via `canAccess` — a `PUBLIC` post is visible to anyone including anonymous requests, everything else needs an `ACTIVE` subscription at the right tier or higher. A creator can also `POST /media/upload-url` (`{mimeType, size}`) to get a presigned URL, `PUT` bytes to it directly (no app server in the middle), then `POST /media/:id/complete` to finalize it, attach the ready asset ids to a post via the `media` field on `POST`/`PATCH /creators/me/posts`, and poll `GET /media/:id` (owner-only) for status; any other viewer's `GET /media/:id/access` is checked against the posts the asset is attached to — same entitlement as `GET /posts/:id` — and returns a short-lived signed download URL (creator-only if the asset is attached to nothing). `GET /feed` (optionally authenticated) returns every `PUBLIC` post platform-wide plus, for a logged-in caller, any `SUBSCRIBERS`/`TIER` post their active subscriptions actually unlock — `?limit=` bounded, newest first. `GET /creators/<handle-or-did>/feed` is the per-creator version: every one of that creator's posts, cursor-paginated (`?limit=&cursor=`), with a post the caller can't see returned as a safe `{id, visibility, createdAt, requiredTier, locked: true}` stub instead of being omitted. `GET /discover` (`?limit=&cursor=`) and `GET /search?q=` (matches handle/displayName/bio) browse the AT-network discovery index — populated by running `pnpm --filter @foryour-fans/api dev:ingest` separately, which connects to a real public Jetstream server and indexes any DID's `fans.foryour.profile`/`post`/`tier` records (and `app.bsky.feed.post` when `INDEX_BSKY_POSTS` is set), not just ones that have signed in here. There is now a web UI for composing and reading posts — `/creator/posts` (composer + your posts), `/feed` (home feed), the Posts tab on `/c/<handle>`, and `/c/<handle>/post/<id>` (a single post; the id can be a local id or either AT URI). The composer has a real drag-and-drop media uploader (client-validated, presigned `PUT` with a progress bar, status poll, reorderable); post views render media on demand through `GET /media/:id/access` with a lightbox and NSFW blur-by-default. With `CREATOR_OWNED_PDS_ENABLED` set, a `PUBLIC` post is dual-published to your PDS as both `app.bsky.feed.post` and `fans.foryour.post` and shows a "Bluesky" chip. `/discover` and `/search?q=` browse and search that same discovery index in the web UI, see Known limitations for what real creator/category/NSFW data it doesn't have yet.

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
state matrix. **This section reflects WEB PHASES 0–10 (design system & app shell,
marketing site, auth experience, `/settings`, creator onboarding, tier
management, subscribe / billing / payout onboarding, the post composer /
private-content views, media upload & rendering, feeds, and discovery &
search) plus WEB PHASE 12 (comments & likes) — WEB PHASE 11 is the vacant
Spaces slot, no UI.**

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
  sections + a real `Featured creators` strip; logged-in personalized panel,
  no redirect), `/about`, `/terms` · `/privacy` · `/legal/compliance`
  (placeholder copy, visible "pending legal review" note, `noindex`),
  `/discover` browse + `/search?q=` (WEB PHASE 10, see below). SEO via
  per-route `metadata`, `app/robots.ts`,
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
  `/c/[handle]` (`components/creator/TierCard.tsx`).
  - **API touch (WEB PHASE 5):** new `GET /creators/me/tiers` (`requireSession`)
    returns the caller's tiers **including deactivated ones** (the public
    `GET /creators/:identifier/tiers` is active-only), and new
    `POST /creators/me/tiers/:tierId/reactivate` (`requireSession` +
    `requireCsrf`) re-publishes a deactivated tier's `fans.foryour.tier` record
    and flips `isActive` back on — the inverse of `DELETE`. `apps/api` and
    `packages/subscriptions` tests added.
- **Subscribe, billing & payouts** (`components/creator/SubscribeButton.tsx`,
  `app/(app)/subscribe/*`, `app/(app)/subscriptions/*`,
  `app/(app)/creator/payouts/*`, `lib/subscriptions.ts`): a per-tier subscribe
  review `Dialog` on `/c/[handle]` (shows the locked-in price + grandfather
  note) → `POST /creators/:identifier/subscribe`. The UI assumes a
  **hosted-checkout redirect** model (dictated by the fake `PaymentProvider`):
  it navigates the browser to the returned `redirectUrl` and reconciles on
  `/subscribe/return` by polling `GET /subscriptions` — there is no synchronous
  "subscribed" state; the row is `PENDING` until the provider webhook lands.
  `/subscriptions` lists the viewer's subscriptions with the snapshot price,
  renewal date, status badge, a `cancelAtPeriodEnd` toggle
  (`PATCH /subscriptions/:id`), resubscribe, and a `past_due` banner.
  `/creator/payouts` renders the four `GET /creators/me/payout-account/status`
  states, gates `POST /creators/me/payout-account` behind a self-declared
  age/identity check (placeholder until WEB PHASE 14), then follows the
  provider's `onboardingUrl`; status is re-polled on focus (no payout webhook).
  - **No API change in WEB PHASE 6** — the Phase 6 API already shipped. The
    `apps/web` Playwright fake API (`apps/api/test/e2e/fakeServer.ts`) gained a
    seeded second creator + tier and in-process stub hosted-checkout /
    onboarding routes (the fake providers' `checkoutBaseUrl` /
    `onboardingBaseUrl` options, added to `packages/subscriptions`, point at
    them) so the redirect round trip and the `PENDING → ACTIVE` webhook
    transition are exercised end-to-end.
- **Post composer & private content** (`app/(app)/creator/posts/*`,
  `app/(marketing)/c/[handle]/post/[id]/`, `components/creator/{PostArticle,LockedPostCard}.tsx`,
  `lib/post.ts`): `/creator/posts` is the creator's own post list (visibility
  badge, relative time, edit, delete-with-confirm; ownership-gated like
  `/creator/tiers`). `/creator/posts/new` and `/creator/posts/:id/edit` share
  `PostComposer` — a plain-text body (line breaks preserved, never rendered as
  HTML/markdown), a three-way visibility selector (`Public` / `Subscribers` /
  `Specific tier`, the last with a tier picker from `GET /creators/me/tiers`),
  and a **persistent, non-dismissible warning** shown only while `Public` is
  selected (the exact mandated copy — public posts hit the open AT Protocol
  network, subscriber content never leaves foryour.fans). Media is a real
  drag-and-drop uploader (WEB PHASE 8, below). `/c/:handle/post/:id` is the public
  permalink: an entitled viewer / the creator / anyone on a `PUBLIC` post sees
  the full `PostArticle`; everyone else gets `LockedPostCard`, built purely
  from the API's locked stub (id, creator, `createdAt`, visibility, required
  tier) — no body text or media ref ever reaches the client, asserted in a
  unit test and an e2e test for the logged-out case. Non-`PUBLIC` and locked
  post pages are `noindex`.
  - **API touch (WEB PHASE 7):** new `PATCH /creators/me/posts/:id`
    (`requireSession` + `requireCsrf`) — the composer's edit mode; a thin
    route over the already-existing `ContentRepository.updatePost` (including
    its PUBLIC-boundary publish/retract transitions), same TIER validation as
    `POST`. And `GET /posts/:id` now returns a **`200` locked stub**
    (`{ …, locked: true, requiredTier, hasMedia }`, never `text`/`media`) for a
    non-entitled viewer instead of `403`, plus the creator's public identity
    on both branches — the same stub shape Phase 9's `GET /creators/:id/feed`
    already returns (`toLockedStub` moved to `routes/posts.ts` and shared).
    No draft state: the `Post` model has no draft/published field, so the
    composer publishes on save — a documented placeholder, like avatar upload
    (WEB PHASE 8).

- **Media upload & rendering** (`components/media/*`, `lib/media.ts`,
  `lib/mediaItems.ts`): the composer's `MediaUploader` is drag-and-drop +
  file picker with client MIME/size validation *before* any presigned URL,
  a real progress bar on the direct-to-storage `PUT` (`XMLHttpRequest` — the
  fetch API has no upload-progress event), a status poll (`processing`
  spinner → `ready` thumbnail / `rejected` reason + remove), and a
  `@dnd-kit`-reorderable list that maps 1:1 to `PostMedia.sortOrder`. Publish
  is disabled until every attachment is `ready`; edit mode seeds the list
  from the post's existing attachments. Post views resolve bytes on demand
  via `useSignedMedia` → `GET /media/:id/access` (never an embedded storage
  URL; the short-lived signed URL is refreshed before it expires) — a
  `MediaGallery` + keyboard-navigable `MediaLightbox` on the single-post
  view, `MediaThumb` (first attachment + "+N") on feed cards. NSFW media is
  blurred by default with a per-item **Reveal** — the mechanism only; there
  is no content-label API before WEB PHASE 14, so `nsfw` defaults off.
  - **API touch (WEB PHASE 8):** `POST`/`PATCH /creators/me/posts` accept
    `media: [{mediaAssetId, sortOrder}]` (validated by `@foryour-fans/content`'s
    `resolvePostMedia`: `READY`, creator-owned, ≤20, deduped, dense
    `sortOrder` → `400` otherwise). `GET /media/:id/access` now follows the
    attached post's entitlement (`checkPostAccess`, same as `GET /posts/:id`)
    instead of "any active subscriber"; unattached = creator-only. New
    owner-only `GET /media/:id` status route for the composer's ready-gate
    poll. `PostRecord.media` carries `mimeType` + intrinsic
    dimensions/duration (layout metadata, never a storage key). No migration
    — `PostMedia` already existed.

- **Feeds** (`app/(marketing)/feed/*`, `app/(marketing)/c/[handle]/CreatorFeed.tsx`,
  `components/post/{PostCard,PostNav}.tsx`, `lib/post.ts`): most of this
  surface — `PostCard`, `CreatorFeed`'s cursor-paginated Posts tab on
  `/c/[handle]`, `postBadges`, `LockedPostCard` — landed early as part of
  `bluesky-public-posts.md`'s web half (below). WEB PHASE 9 adds `/feed`
  itself and closes the remaining gaps: `/feed` moved from `(app)` to
  `(marketing)` so an anonymous visit is a chosen answer — a `FeedLoggedOut`
  explainer (`Log in` / `Browse creators`) — rather than the `(app)` group's
  redirect or the real PUBLIC-only stream the API would actually serve one;
  signed-in visitors get `GET /feed?limit=20` rendered as `PostCard`s with a
  "Load more" that re-fetches at a larger limit (the route is limit-only, no
  cursor, by backend design) and an `EmptyState` linking to `/discover`.
  `postBadges()` gains a fifth card state, **Subscribed**, on an unlocked
  `SUBSCRIBERS`/`TIER` post when the viewer isn't its owner (`viewerIsOwner`,
  threaded from `CreatorFeed`'s existing `isOwner`) — `Public`,
  `Subscriber-only`, `Tier`, and `Locked` were already distinct via badge +
  body presence. `/c/[handle]/post/[id]` gains Newer/Older navigation
  (`PostNav`, rendered by both `PostArticle` and `LockedPostCard`): a new
  pure `findFeedNeighbors` helper locates the post within one `limit=50` page
  of `GET /creators/:id/feed` (there's no dedicated neighbors route); a post
  older than that window just gets no nav. **No API changes** — WEB PHASE 9
  consumes `GET /feed` and `GET /creators/:identifier/feed` exactly as Phase
  9 shipped them.

- **Discovery & search** (`app/(marketing)/discover/page.tsx`,
  `app/(marketing)/search/page.tsx`, `components/discover/*`,
  `lib/discover.ts`): `/discover` (browse) and a new `/search?q=` route share
  one client component, `DiscoverBrowser` — seeded server-side with a
  different first page each (`GET /discover` vs `GET /search`), then a
  debounced (350ms) search input re-fetches client-side and mirrors the query
  into the URL with `history.replaceState` (never a Next navigation, so
  typing never remounts the page). Results render as a cursor-paginated grid
  of `CreatorCard`s through `InfiniteList` — a WEB PHASE 0 primitive with no
  real consumer until now. **Thin API addition**: `GET /discover`/`GET
  /search` now also return `avatarUrl`/`tierCount`/`fromPriceCents` for a
  *registered* creator (sourced from the local `Creator`/`SubscriptionTier`
  tables), `null`/`0` for an indexed-but-unregistered profile — `CreatorCard`
  uses `isRegisteredCreator` to decide whether a result links to `/c/:handle`
  at all, so an unregistered result renders inert instead of a click-through
  to a 404. The home page's `Featured creators` strip (stubbed since WEB
  PHASE 1) now renders the first page of `GET /discover` the same way. No
  "new"/"active"/"by category" sections and no NSFW/age gating — `full.md`
  PHASE 10 never defines a category concept and there is still no
  content-rating field anywhere in the schema (see Known limitations).

- **Comments & likes** (`components/post/{LikeButton,CommentThread,
  CommentComposer}.tsx`, `lib/{likes,comments}.ts`): both render only on
  `/c/[handle]/post/[id]`'s `PostArticle` — never `LockedPostCard` — so
  "access inherited from the parent post" holds by construction, matching
  the backend's own rule. `LikeButton` optimistically toggles with
  rollback-on-error (a failed request restores the prior count/pressed-state
  and shows an error toast) and a "Liked by `<creator>`" indicator; an
  anonymous viewer gets a login link instead of a button. `CommentThread` is
  oldest-first, cursor-paginated via `InfiniteList` (the same
  fetch-and-append pattern WEB PHASE 10's `DiscoverBrowser` established); a
  signed-in viewer gets `CommentComposer`, everyone else a "log in to
  comment" prompt — the backend requires a session to comment on *any* post,
  `PUBLIC` included, so an anonymous composer would just `401` on submit. The
  post's own creator's comments are badged **Creator**. A Report `Flag`
  entry point sits on each comment but only shows a "not available yet"
  toast — the dialog itself is WEB PHASE 14's job. **Thin API additions**
  (same precedent as WEB PHASEs 5/7/8/10): `GET /posts/:id`'s unlocked
  response gains `likeCount`/`likedByViewer`/`likedByCreator`
  (`getLikeSummary`, `packages/content/src/likes.ts` — still no dedicated
  `GET /posts/:id/likes` route); `GET /posts/:id/comments` changed shape from
  a bare array to `{comments, nextCursor}` (matching `GET /discover`'s own
  cursor convention) since this phase is its first real consumer.

### Web commands

| Command | What it does |
|---|---|
| `pnpm dev:web` | `next dev` (browse `http://127.0.0.1:3000`) |
| `pnpm --filter @foryour-fans/web lint` | ESLint (`--max-warnings=0`) over `app`, `components`, `lib` |
| `pnpm --filter @foryour-fans/web typecheck` | `tsc --noEmit` |
| `pnpm --filter @foryour-fans/web test` | Vitest + React Testing Library (jsdom) |
| `pnpm --filter @foryour-fans/web test:e2e` | Playwright flows — auth round-trip, creator onboarding, tiers, subscribe/checkout, payouts, posts/media, discovery, feeds, comments & likes (needs Postgres + Redis; starts a fake-OAuth API + a prod web build) |
| `pnpm --filter @foryour-fans/web build` | `next build` |

## Known limitations (Phases 1–10)

- **Doc-based research pointed at the wrong Jetstream wire format; live verification caught it.** Initial research (fetching bsky.network's docs) described a "v2" envelope shape (`{$type: "message", payload: {...}}`) as "recommended for new projects" — but connecting directly to the real production endpoint (`wss://jetstream.us-east.bsky.network/subscribe`) showed it actually serves the flat v1 shape (`{did, time_us, cursor, kind: "commit", commit: {...}}`), and the query param is `wantedCollections`, not `collections`. `packages/discovery/src/jetstreamTypes.ts` and `ingestor.ts` are built against the verified-real format; see docs/architecture.md's Phase 10 section for the full verification transcript. This is exactly the class of gap `prompts/full.md`'s "research current recommended AT Protocol mechanisms before implementing" instruction exists to catch — and why a live check, not just a doc fetch, mattered here.
- Jetstream's `identity` event kind (network-wide handle-change notifications) is deliberately NOT subscribed to — see docs/architecture.md for the bandwidth/scoping tradeoff. `IndexedCreatorProfile.handle` is refreshed only when a `fans.foryour.profile`/`post`/`tier` commit for that DID is observed (each triggers a live `resolveDid` call), not proactively — it can go stale between a creator's own commits, mirroring the same kind of staleness `CreatorHandleHistory` already accepts for `User.handle`.
- The discovery index (`IndexedCreatorProfile`/`IndexedPost`/`IndexedTier`) can include a DID that has never signed in to this app at all — any DID publishing `fans.foryour.*` records is indexed, which is the intended behavior for an AT-network-wide discovery surface, not a bug. Visiting `/c/<handle>` for such a DID still 404s today (`findActiveCreatorByIdentifier` only knows the local `Creator` table) — `isRegisteredCreator` on each `/discover`/`/search` result is what the WEB PHASE 10 `CreatorCard` reads to decide whether a result links to `/c/:handle` at all; an unregistered one renders inert with a "Not on foryour.fans yet" badge instead of a dead-end click-through.
- `searchCreators` is plain case-insensitive `contains` matching across `handle`/`displayName`/`bio` — not full-text or trigram search, no relevance ranking. A reasonable starting point per `prompts/full.md`'s literal "search by: creator name, handle, bio," not a claim of search quality.
- The Jetstream ingestion consumer (`apps/api/src/ingest.ts`) is a separate long-lived process from the HTTP server (`server.ts`) — on purpose, so N horizontally-scaled API replicas (Phase 16) don't each independently re-consume the same firehose and race to write the same index. It has no Kubernetes manifest of its own yet (Phase 16 doesn't exist yet either) — a known, deliberate gap, not an oversight.
- A restarted ingestion process resumes from the last-persisted cursor (`IngestionCursor`, keyed on `time_us`) — but an *abandoned* `POST /media/upload-url` has an equivalent-shaped gap on the media side (see below); neither this project's ingestion cursor nor its media uploads have a garbage-collection story yet for the "started but never finished" case.
- **A real, previously-undetected cross-file test race, found and fixed during Phase 10 development**: three new `packages/discovery` test files share the `indexed_creator_profiles` table, and two of them originally used a blanket `afterEach(() => prisma.indexedCreatorProfile.deleteMany({}))` — since vitest runs test files in parallel, one file's `afterEach` could wipe rows a *different*, concurrently-running file's test hadn't finished asserting on yet. Same category of bug as Phase 6's handle-collision flake, just via deletion instead of creation this time. Fixed by scoping every cleanup to the specific `did`(s) each test created, never a blanket wipe — see `packages/discovery/src/indexer.test.ts`'s `cleanup()` doc comment, and follow the same rule for any future test file touching a table another test file also touches.

- `PostMedia` now has a writer (WEB PHASE 8): `POST`/`PATCH /creators/me/posts` accept `media: [{mediaAssetId, sortOrder}]`, validated in `@foryour-fans/content`'s `resolvePostMedia` (asset must exist, be owned by the posting creator, and be `READY`; ≤20 attachments; `sortOrder` is deduped and re-packed dense). `GET /media/:id/access` follows the attached post's entitlement — the asset's creator always, otherwise the viewer must be able to read at least one post the asset is attached to under the same `checkPostAccess` as `GET /posts/:id` (so a `TIER`-gated post's media needs a sufficient-tier subscription, a `PUBLIC` post's media is visible to anyone). An **unattached** asset is creator-only. A non-`READY` asset never yields a signed URL. Media *bytes* still live in app object storage, not the creator's PDS (a `creator-owned-pds.md` deferral).
- `packages/media`'s real, shipped `MediaProcessor` (`PassthroughMediaProcessor`) does no actual scanning — it always marks an upload `READY`. `prompts/full.md`'s Phase 8 note is explicit that this is correct for now ("do not build full transcoding infrastructure unless necessary yet"); real virus/moderation scanning is Phase 14's job, plugging into the exact same `PENDING_UPLOAD → PROCESSING → READY/REJECTED` state machine with zero schema change.
- An abandoned upload (a client calls `POST /media/upload-url` but never `PUT`s bytes, or never calls `/complete`) leaves an orphaned `PENDING_UPLOAD` row and reserved storage key forever — nothing garbage-collects it. Not a data-integrity risk (nothing reads a non-`READY` asset), just wasted rows/storage.
- `GET /creators/:creator/posts` (Phase 7) still exists unchanged, alongside the new `GET /creators/:creator/feed` (Phase 9) — they're deliberately different: `/posts` is simple, unpaginated, and silently omits posts the caller can't see; `/feed` is cursor-paginated and returns every post, downgrading an inaccessible one to a safe locked stub instead of omitting it. Both are real, live routes; nothing deprecates `/posts`.
- There is no `Follow` model anywhere in `prompts/full.md`'s 17 phases, so `GET /feed`'s "public posts from followed/discovered creators" (the spec's literal phrase) collapses to "every `PUBLIC` post platform-wide" — `PUBLIC` already means visible to anyone, so there's no relationship left to gate that half on. Documented as an inferred reading in docs/architecture.md, not a guess left silent.
- `GET /feed` has no cursor — only `?limit=` (default 20, max 100), newest-first. Adding real cursor pagination there hit real complexity Phase 9's own spec text doesn't ask for (filtering by `canAccess` *after* fetching a page across many creators can legitimately return fewer than `limit` accessible posts even though more exist further down); the route over-fetches a fixed pad (20 extra candidates) as a pragmatic partial mitigation, not a strict guarantee. `GET /creators/:creator/feed` has real, correct cursor pagination instead, since it never drops a row — an inaccessible post becomes a locked stub, not an omission, so nothing is filtered out of an already-fetched page.
- `GET /creators/:creator/feed`'s cursor contract is the simple "always return a `nextCursor`, stop paging on an empty page" shape (not a peek-ahead "is there really more" check) — one extra empty round trip at the very end is expected, not a bug.
- A rare (~1 in 23 observed), unreproduced test flake surfaced once during Phase 8 development: `subscriptions.test.ts`'s idempotency test failed a `createTierFor` helper call during a full `pnpm test` (all workspace packages running concurrently) but passed cleanly in 22 subsequent full-suite runs and 12 apps/api-only runs. Active Postgres connections peaked at 6-7 during a monitored run (well under the 100-connection limit), so straightforward pool exhaustion doesn't explain it. Documented rather than silently ignored per this project's convention, but NOT treated as a confirmed root-caused bug — if it recurs with more frequency or a captured stack trace, it needs real investigation, not another guess.
- `ContentRepository.updatePost` is fully implemented (including the PUBLIC-visibility-transition AT publish/retract logic — see `packages/content/src/repository.test.ts`) but has no HTTP route in Phase 7 — `prompts/full.md`'s Phase 7 route list only ever specifies `POST`/`GET`/`DELETE`, never a `PATCH`.
- `AtprotoSpacesContentRepository` (`packages/content/src/atprotoSpacesRepository.ts`) is an intentionally unimplemented stub per `prompts/full.md`'s Phase 7 instruction ("define, but DO NOT make production-dependent") — every method throws. Nothing in `apps/api` constructs or wires it; only `PrivateContentRepository` is ever instantiated (see `apps/api/src/server.ts`). It becomes real in [`prompts/atproto-spaces.md`](./prompts/atproto-spaces.md), the extracted experimental phase that runs dead last.
- Only a fake `PaymentProvider`/`PayoutProvider` exist — `prompts/full.md` is explicit that Phase 6 builds the abstraction, not a real processor integration. Real money must never move through `FakePaymentProvider`/`FakePayoutProvider`; see docs/architecture.md.
- The `/subscriptions` **past-due "update payment method" button is a disabled placeholder** — the Phase 6 API has no provider payment-portal route (`PaymentProvider` only exposes `createCustomer`/`createSubscription`/`cancelSubscription`/`handleWebhook`). The banner still surfaces the state; wiring a real "update payment" hosted flow needs a new API route.
- `/creator/payouts` can only ever show **`not started`** and **`pending verification`** with the fake `PayoutProvider` (`getAccountStatus` always returns `pending`, and there's nothing to transition it to). The `verified` and `restricted` views are built and unit-tested but dormant until a real provider exists. The age/identity checkbox is a self-declaration placeholder until WEB PHASE 14's KYC flow.
- `/subscribe/return` reconciles purely by polling `GET /subscriptions` (≤6× over ~9s) — there is no entitlement endpoint and no push. A subscription still `PENDING` after that shows a "payment processing" state with a manual re-check, not a spinner. In `apps/web` e2e the `PENDING → ACTIVE` step is driven by the fake API's stub checkout page firing the `subscription.activated` webhook; in real use it waits on the provider.
- The `apps/web` Playwright suite seeds a **second creator** (`e2e-creator.test`) in `apps/api/test/e2e/fakeServer.ts` because the fixture identity can't subscribe to itself (`subscribeToTier` rejects self-subscription). The fake payment/payout providers are pointed at in-process `/__e2e__/*` stub routes there instead of the unreachable `*.example` hosts.
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

## Known limitations (Bluesky-compatible public posts)

- **Dual-publish is still flag-gated.** A `PUBLIC` post is only written as `app.bsky.feed.post` when `CREATOR_OWNED_PDS_ENABLED` is set (default off, paused for privacy review — see `docs/creator-owned-pds.md`). On the default `PrivateContentRepository` path a `PUBLIC` post is still only a `fans.foryour.post`; API responses just gained nullable `foryourAt*` / `bskyAt*` / `canonicalUri` / `sourceCollections` fields (all null / `["fans.foryour.post"]` there).
- **The `app.bsky.feed.post` carries no backlink to the `fans.foryour.post`.** The link is one-way (custom → Bluesky, via `bskyUri`). There is no non-degrading place to put a fan-service reference in a normal Bluesky post — see `docs/bluesky-public-posts.md` §4.
- **`INDEX_BSKY_POSTS` is off by default.** `wantedCollections` can't scope a Jetstream subscription to a set of DIDs, so indexing `app.bsky.feed.post` means ingesting the whole Bluesky firehose. With the flag on, `packages/discovery` still drops any event for a DID it doesn't already track (`IndexedCreatorProfile` / local `Creator`). A future `wantedDids`-scoped subscription would let this be on by default — same shape as the `identity`-event tradeoff above.
- **The local `GET /feed` can't produce duplicates** (one `Post` row per authored post), so its `canonicalUri` dedupe is a guard. `mergeIndexedPosts` (`packages/discovery/src/merge.ts`) is the real merge/dedupe, for a future indexed/network feed and the creator page's Bluesky-only posts.
- **Public-post media bytes are still deferred.** The composer is text-only; `buildImagesEmbed` / `buildExternalEmbed` / `assertPublicImage` exist in `packages/atproto/src/bskyPost.ts` but nothing calls them — moving media bytes to the creator's PDS as `fans.foryour.media` blobs is still the creator-owned-PDS implementation phase's job (`docs/creator-owned-pds.md` §9).
- **The `app.bsky.feed.post` body has not been rendered in a real Bluesky client.** The lexicon rules were pinned from vendored JSON + `@atproto/api` types, not by publishing to `bsky.social` and viewing the result (no automatable interactive OAuth — same limitation every prior phase documented). `parseFacets`'s link/mention regexes approximate `@atproto/api`'s `RichText.detectFacets` and may miss unusual URLs — re-verify against a real corpus before the flag is turned on in production.
- **Bluesky lexicons are vendored, not codegen'd.** `packages/lexicons/vendor/app/bsky/**` is reference/pinning only; re-vendor from `bluesky-social/atproto` if Bluesky changes the lexicon, then re-run `packages/atproto`'s `bskyPost` tests.
- **A rollback that itself fails leaves an orphan.** If a `fans.foryour.post` publish fails and the compensating `app.bsky.feed.post` delete also fails, the orphaned Bluesky record is logged (`console.error`) and no local `Post` row is created (`502`). A periodic repair job that reconciles orphaned Bluesky records is future work.
- **`apps/api/test/**` is now actually type-checked** — a real, previously-undetected gap found during Phase 8: `apps/api`'s `pnpm typecheck` (`tsc -p tsconfig.json`) only ever covered `src`, since `tsconfig.json`'s `include` never listed `test`, and there was no error-until-Phase-8 to reveal it. Fixed with a second config, `apps/api/tsconfig.typecheck.json` (`include: ["src", "test"]`, `noEmit`, separate `rootDir`), now what `pnpm typecheck` actually runs — `apps/api/tsconfig.json` (the one `pnpm build` uses) is untouched, so compiled `dist/` output still never includes test files. See docs/architecture.md.
- `GET /auth/atproto/callback` redirects the browser to `<PUBLIC_URL>/auth/callback` after the token exchange (and to `…/auth/callback?error=<code>` on a cancelled/failed authorization) — the web app finishes routing from there (WEB PHASE 2). It previously redirected straight to `/dashboard` and returned a JSON `400` on failure.
- `POST /me/refresh` (`requireSession` + `requireCsrf`, added for WEB PHASE 3) re-pulls the caller's cached profile fields (`handle`/`displayName`/`avatarUrl`/`bannerUrl`) from their PDS via `oauthClient.restore(did)` → `fetchProfile` → `syncUserFromProfile`, and returns the same shape as `GET /me`. `502` if the AT session can't be restored or the profile fetch fails; the DID is never modified.

## Creator-owned PDS storage (proof-of-concept landed)

The first rearchitecture phase ([`prompts/creator-owned-pds.md`](./prompts/creator-owned-pds.md)) has a **backend proof-of-concept in place**, gated behind two flags that are **off by default** so Phases 1–10 behaviour is unchanged pending a privacy review. See [`docs/creator-owned-pds.md`](./docs/creator-owned-pds.md) for the protocol research and the go/defer decision.

- **Protocol research** — `docs/creator-owned-pds.md` documents what today's AT Protocol / PDS surface offers for permissioned creator-owned content, with source links and flagged assumptions.
- **Public content ships creator-owned.** With `CREATOR_OWNED_PDS_ENABLED`, a public post is dual-published to the creator's own PDS as `app.bsky.feed.post` + `fans.foryour.post` (linked by AT URI/CID); Postgres becomes a rebuildable cache (`isAuthoritative = false`, `sourceUri`/`sourceCid`). `CreatorOwnedContentRepository.rebuildFromPds()` reconstructs the cache from PDS records alone.
- **Gated content is deferred behind a documented protocol gap.** Encrypted-blob-on-PDS is not production-safe (offline attack on firehose-archived ciphertext; atproto Spaces is still alpha and provides access control, not confidentiality — see `docs/creator-owned-pds.md` §4/§7). With `CREATOR_OWNED_GATED_CONTENT_ENABLED` (dev only) the encrypted path is fully wired — AES-256-GCM per-post keys, a `fans.foryour.accessPolicy` record, and an entitlement-checked `POST /content-keys/grant` — but with the flag off, `SUBSCRIBERS`/`TIER` posts stay Postgres-only and app-authoritative.
- New lexicons: `fans.foryour.media`, `fans.foryour.accessPolicy`, `fans.foryour.serviceConfig`; `fans.foryour.post` gains optional `visibility` / `accessPolicy` / `encryptedBody` / `bskyUri` / linkage fields.
- One-off migration: `pnpm --filter @foryour-fans/api migrate:pds` (conservative — a creator with no OAuth session is left completely untouched; gated posts are counted, not migrated).

Still deferred to the implementation phase (out of the PoC's "stop after backend proof-of-concept" scope): moving media **bytes** off app-owned S3 (the `fans.foryour.media` lexicon + encryption helpers exist; the `packages/media` upload-path rewrite and `PostMedia` writer do not), the web UI changes, and production migration.

## Known limitations (Phase 12 — Comments, Likes, and Social Interaction)

Routes: `POST`/`GET /posts/:id/comments`, `POST`/`DELETE /posts/:id/likes` — see `apps/api/src/routes/comments.ts` / `likes.ts`.

- **Comments and likes are Postgres-only, always** — neither is ever mirrored to AT Protocol, even for a `PUBLIC` post. `prompts/full.md` PHASE 12 is explicit that a protected post's comments must not be exposed via AT unless deliberately designed to be, and applying that rule uniformly (rather than only to gated posts) keeps one rule instead of a visibility-dependent one. Whether a *public* post's interactions should eventually get a Bluesky-native representation (`app.bsky.feed.like`/reply) is flagged as an open question in `prompts/full.md`'s Phase 12 preamble, not decided here.
- **Access is inherited entirely from the parent post**, via a new shared helper, `loadAccessiblePost` (`apps/api/src/routes/posts.ts`) — the same `checkPostAccess` entitlement gate `GET /posts/:id` already uses. Unlike `GET /posts/:id` (which returns a `200` locked stub so the UI has something to render), a comment/like route has nothing safe to return short of the content itself, so a denial here is a real `403` (anonymous or non-entitled) or `404` (post doesn't exist / creator suspended).
- **`POST`/`DELETE /posts/:id/likes` are idempotent** — liking an already-liked post, or unliking a never-liked one, is a safe no-op returning the current `{likeCount, likedByViewer}` state, not an error. Enforced by the `Like` model's `@@unique([postId, userId])` plus an `upsert`, not just application-level logic.
- **No `GET /posts/:id/likes` route** — `prompts/full.md` PHASE 12's route list only has `POST`/`DELETE`; a viewer's like state comes back from those two calls. `packages/content/src/likes.ts#getLikeState` exists for internal reuse (e.g. a future `GET /posts/:id` enrichment) but nothing calls it yet — adding `likeCount`/`likedByViewer` to the post response is left to a future web-track "thin API addition," the same pattern WEB PHASEs 5/7/8/10 used, rather than invented here.
- **No comment edit/delete.** `prompts/full.md`'s route list for this phase is create + list only; a `Comment` row, once created, is immutable and permanent in this phase. Moderation-driven removal is Phase 14's job (`ModerationCase`/`ContentLabel`), not this one.
- **No rate limiting yet** — `prompts/full.md` PHASE 15 (Production Hardening) owns that; a caller can currently comment/like as fast as requests land. `prompts/web.md` WEB PHASE 12 already documents surfacing a rate-limit `429` as a friendly toast once the backend actually returns one.
- **A real, pre-existing env-parsing bug was found and fixed incidentally while smoke-testing this phase's "app starts" exit criterion.** `apps/api/src/config/env.ts` used `z.coerce.boolean()` for `S3_FORCE_PATH_STYLE`/`INDEX_BSKY_POSTS`/`CREATOR_OWNED_PDS_ENABLED`/`CREATOR_OWNED_GATED_CONTENT_ENABLED` — but `z.coerce.boolean()` runs plain `Boolean(value)` on whatever string an env var holds, so the literal string `"false"` (exactly what `.env.example` sets for every one of these "off by default" flags) coerced to `true`. A fresh checkout that copied `.env.example` verbatim would have booted with `CREATOR_OWNED_GATED_CONTENT_ENABLED` effectively on. Replaced with `booleanEnvFlag()`, a real string-to-boolean parser (`"true"`/`"1"` → true, everything else including unset → the documented default); regression-covered in `apps/api/test/env.test.ts`. Verified end-to-end: `apps/api/dist/server.js` now boots cleanly against `.env.example`'s literal contents, which previously threw `CONTENT_KEY_WRAP_SECRET is required when CREATOR_OWNED_GATED_CONTENT_ENABLED=true` at startup.

## Next phase

Both post-Phase-10 rearchitecture specs have run — [`prompts/creator-owned-pds.md`](./prompts/creator-owned-pds.md) (backend proof-of-concept, flag-gated, paused for privacy review — see "Creator-owned PDS storage" above) and [`prompts/bluesky-public-posts.md`](./prompts/bluesky-public-posts.md) (implemented, still flag-gated — see "Known limitations (Bluesky-compatible public posts)" above). Phase 12 (Comments, Likes, and Social Interaction) and its web counterpart, WEB PHASE 12, are now done too — see "Web app" above and [`docs/ux.md`](./docs/ux.md)'s "Known limitations after WEB PHASE 12".

Next is **Phase 13 — Creator Dashboard** (`/creator/dashboard`: subscriber count, active subscriptions, MRR, revenue by tier, new subscribers, cancellations, recent posts, date filters — all from the billing DB/provider, never derived from AT Protocol; ownership-protected) and its web counterpart, **WEB PHASE 13**. The old **Phase 11 / WEB PHASE 11 slot stays vacant**: AT Protocol Spaces has been extracted to [`prompts/atproto-spaces.md`](./prompts/atproto-spaces.md), which runs **dead last** (after Phase 17), reframed from "the private-content storage backend" to, at most, a key-grant / permission transport layered over encrypted creator-owned storage.

Full order: `creator-owned-pds.md` → `bluesky-public-posts.md` → Phase 12 (done) → Phases 13–17 → `atproto-spaces.md`. Web track in parallel: `WEB PHASE 12` (done) → `WEB PHASE 13`–`17`. See [`docs/build-plan.md`](./docs/build-plan.md) → "Planned rearchitecture".
