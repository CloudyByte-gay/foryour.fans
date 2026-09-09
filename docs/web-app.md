# Web app (`apps/web`)

The Next.js 15 / React 19 web client. This is the detailed, phase-annotated
feature and implementation inventory that used to live in the repository
README. Companion documents:

- [`docs/ux.md`](./ux.md) — the living screen inventory and auth/role state matrix
- [`docs/ux-review.md`](./ux-review.md) — route × persona matrix, flow diagrams, UX/security risks
- [`docs/web-accessibility.md`](./web-accessibility.md) — the accessibility audit
- [`prompts/web.md`](../prompts/web.md) — the phase-by-phase spec this was built from

---

Built phase-by-phase from [`prompts/web.md`](../prompts/web.md); see
[`docs/ux.md`](./ux.md) for the living screen inventory and auth/role
state matrix. **This section reflects WEB PHASES 0–10 (design system & app shell,
marketing site, auth experience, `/settings`, creator onboarding, tier
management, subscribe / billing / payout onboarding, the post composer /
private-content views, media upload & rendering, feeds, and discovery &
search), WEB PHASE 12 (comments & likes), WEB PHASE 13 (creator
dashboard), WEB PHASE 14 (trust & safety: report/block dialogs, a
client-only age-gate self-attestation, real creator identity-verification
gating adult-content tiers/posts, content-label reveal, account-status
banners, and a role-gated `/admin` moderation console), and WEB PHASE 15
(hardening — no new product features: per-segment error/loading boundaries,
an accessibility audit with real WCAG AA contrast/heading/link fixes and two
new permanent automated checks, a performance/bundle review, and a 360px
responsive check — see [`docs/web-accessibility.md`](./web-accessibility.md)), and WEB PHASE 16
(deployment: `output: "standalone"`, a production Dockerfile, a typed
`lib/env.ts`, a per-request nonce-based CSP in `middleware.ts` plus static
security headers in `next.config.mjs`, a `/healthz` route, and the
Kubernetes manifests + CI Playwright wiring — see
[`infrastructure/kubernetes/README.md`](../infrastructure/kubernetes/README.md))**
— WEB PHASE 11 is the vacant Spaces slot, no UI.

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
  states. Starting onboarding requires a **verified creator identity**
  (`Creator.verificationStatus === "VERIFIED"` — a WEB PHASE 15 audit fix;
  `POST /creators/me/payout-account` 403s otherwise, and the page shows a
  pointer to `/creator/verification` instead of the start flow), plus a
  self-declared 18+ checkbox on top of that, then follows the provider's
  `onboardingUrl`; status is re-polled on focus (no payout webhook).
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

- **Creator dashboard** (`app/(app)/creator/dashboard/`,
  `components/dashboard/*`, `lib/dashboard.ts`): `/creator/dashboard` renders
  `GET /creators/me/dashboard` — four always-visible stat tiles (subscriber
  count, active subscriptions, new subscribers, cancellations), a revenue
  card (MRR + a ranked, inline-bar revenue-by-tier breakdown), two
  single-series `recharts` area charts (subscribers-over-time,
  MRR-over-time — a title names each series, so neither needs a legend),
  and a recent-posts list. A `DateRangeFilter` (7/30/90-day presets plus
  custom start/end `<input type="date">`s) re-fetches client-side on
  change; the initial 30-day page is server-rendered. **Only figures
  denominated in money** (MRR, revenue by tier, the MRR chart) are masked
  behind a `PayoutGate` — "complete payout onboarding to see earnings",
  linking to `/creator/payouts` — until payout status is `VERIFIED`;
  subscriber/engagement numbers are never gated by it. A brand-new creator
  (no tiers, no posts, never had a subscriber) sees a `NewCreatorGuidance`
  checklist (publish a post / create a tier / finish payout onboarding)
  instead of an all-zero-looking dashboard. **No API changes** — WEB PHASE
  13 consumes `GET /creators/me/dashboard` exactly as Phase 13 shipped it.

## Web commands

| Command | What it does |
|---|---|
| `pnpm dev:web` | `next dev` (browse `http://127.0.0.1:3000`) |
| `pnpm --filter @foryour-fans/web lint` | ESLint (`--max-warnings=0`) over `app`, `components`, `lib` |
| `pnpm --filter @foryour-fans/web typecheck` | `tsc --noEmit` |
| `pnpm --filter @foryour-fans/web test` | Vitest + React Testing Library (jsdom) |
| `pnpm --filter @foryour-fans/web test:e2e` | Playwright flows — auth round-trip, creator onboarding, tiers, subscribe/checkout, payouts, posts/media, discovery, feeds, comments & likes, creator dashboard (needs Postgres + Redis; starts a fake-OAuth API + a prod web build) |
| `pnpm --filter @foryour-fans/web build` | `next build` |
