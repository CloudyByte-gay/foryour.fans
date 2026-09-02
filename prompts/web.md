# Codex Build Plan — foryour.fans Web UI

We are building the web client for **foryour.fans**, an AT Protocol-native paid
creator platform (an "OnlyFans copy" built on portable AT Protocol identity).

This file is the phase-by-phase spec for `apps/web` — the Next.js frontend.
It is the companion to:

- [`prompts/full.md`](../prompts/full.md) — the backend/API build plan. That file
  is the source of truth for **what the API exposes**. This file never invents an
  API; it consumes what `full.md`'s phases ship.
- [`docs/build-plan.md`](../docs/build-plan.md) — the project tracker.

The web app already exists as a bare, unstyled skeleton (App Router, React 18,
no CSS, a handful of routes: `/`, `/login`, `/dashboard`, `/become-a-creator`,
`/creator/settings`, `/c/:handle`). This plan turns that skeleton into a real
product UI with a marketing site, authenticated app, creator tooling, and a
moderation console.

## Relationship to the backend phases

Each `WEB PHASE n` shadows `full.md`'s `PHASE n` and must not be started before
the API routes it consumes exist. Exceptions: `WEB PHASE 0` and `WEB PHASE 1`
have no backend dependency beyond the already-shipped Phases 1–3 and can be built
now.

**Between `WEB PHASE 4` and `WEB PHASE 5`, run the web half of
[`prompts/handle-identity.md`](./handle-identity.md)** (after its backend half
lands). It removes the creator slug: the public creator identifier becomes the
AT handle or DID, `/c/:handle` replaces `/c/:slug`, the onboarding wizard loses
its Slug step, and `/creator/settings` loses the slug-change dialog. Every
`WEB PHASE 5`+ reference below already assumes this — no slug, `/c/:handle`.

**`WEB PHASE 11` (Spaces) has been extracted** to
[`prompts/atproto-spaces.md`](./atproto-spaces.md) and runs **dead last**. The
slot is left vacant (not renumbered) so every `WEB PHASE 12`–`17` reference still
resolves; build `WEB PHASE 12`–`17` straight after `WEB PHASE 10`.

**After every numbered `WEB PHASE`, run the web halves of
[`prompts/creator-owned-pds.md`](./creator-owned-pds.md) then
[`prompts/bluesky-public-posts.md`](./bluesky-public-posts.md)** (in that
confirmed order, each after its backend half lands). They add a creator
portability/status panel (DID, handle, PDS URL, record collections, last sync),
split composer copy between Bluesky-compatible public posts and encrypted gated
posts, merge a dual-published post's two AT records into one feed card, and
resolve a single post by local id / `fans.foryour.post` URI / `app.bsky.feed.post`
URI. Cross-cutting requirement #4 extends: decryption keys for content the
viewer can't access never reach the client. `WEB PHASE 12`+ assume both have
landed. Then `prompts/atproto-spaces.md` runs last (no user-facing surface). See
`docs/build-plan.md` → "Planned rearchitecture".

| Web phase | Consumes API from | Notes |
|-----------|-------------------|-------|
| 0 Design system & app shell | Phases 1–3 (done) | `/me`, session cookie |
| 1 Marketing & landing | Phase 2 (done) | logged-out + logged-in hero |
| 2 Auth UX | Phase 2 (done) | OAuth start/callback/logout |
| 3 Viewer account & settings | Phases 2–3 (done) | handle, DID, avatar |
| 4 Creator onboarding & public page | Phase 4 | `/c/:handle` (see below re: slug removal) |
| 5 Tier management | Phase 5 | tier CRUD |
| 6 Subscribe, billing & payout onboarding | Phase 6 | fake provider, hosted-checkout redirect shape |
| 7 Post composer & private content | Phase 7 | visibility, entitlement-gated reads |
| 8 Media upload UX | Phase 8 | presigned upload/download, status lifecycle |
| 9 Feeds | Phase 9 | `/feed`, locked-post metadata |
| 10 Discovery & search | Phase 10 | `/discover`, `/search` |
| ~~11~~ | — | Spaces UI extracted to [`prompts/atproto-spaces.md`](./atproto-spaces.md); runs dead last, no user-facing surface |
| 12 Comments & likes | Phase 12 | access inherited from post |
| 13 Creator dashboard | Phase 13 | revenue/subscriber analytics |
| 14 Trust & safety UX + admin console | Phase 14 | reports, blocks, age/KYC verification, moderation |
| 15 Polish, a11y, performance, errors | Phase 15 | hardening pass |
| 16 Web deployment & build config | Phase 16 | Docker image, k8s, CSP |
| 17 UX review | Phase 17 | `docs/ux-review.md`, no new features |

## Product scope & alignment

Implement **only** what `full.md` exposes. The following OnlyFans-style features
are **explicitly out of scope for every phase in this file** — do not build UI
for them, do not add routes or nav entries for them. Flag them in
`docs/ux.md` as future work:

- direct messaging / inbox
- pay-per-view unlockable messages, tipping, "unlock this post for $X"
- live streaming, stories/ephemeral posts
- native mobile apps
- creator-to-creator collaboration posts

If the product later wants these, they are new `full.md` phases first, then new
`web.md` phases — not a scope expansion of an existing phase.

## Tech & library choices

Keep the existing setup and add the minimum needed:

- **Framework**: Next.js App Router (already scaffolded), React 18, TypeScript.
  Keep the existing `/api/*` rewrite proxy in `next.config.mjs` so the session
  cookie stays same-origin. Keep `lib/serverApi.ts` (server-side, cookie-
  forwarding fetch) as the pattern for first render and auth-gated pages.
- **Styling**: Tailwind CSS with CSS-variable design tokens; dark mode via the
  `class` strategy. No CSS-in-JS runtime.
- **Primitives**: Radix UI (`Dialog`, `DropdownMenu`, `Tabs`, `Tooltip`,
  `Popover`, `Toast`, `Avatar`, `Switch`, `Slider`) wrapped in a local
  `apps/web/components/ui/` layer. Do **not** stand up a `packages/ui` workspace
  package until a second consumer exists.
- **Client data**: TanStack Query for interactive and paginated views (feed,
  search, optimistic likes). RSC + `serverApi` for everything that can render on
  the server.
- **Forms**: `react-hook-form` + `zod`. Share validation schemas with the API
  through `packages/shared` where the shapes match (tier fields, etc.).
- **Typed API client**: generate a client from the API's OpenAPI document
  (`full.md` lists OpenAPI as a preference). No hand-maintained response
  interfaces that can silently drift from the server.
- **Icons**: `lucide-react`. **Charts** (WEB PHASE 13): one small lib, e.g.
  Recharts or visx — decided in that phase, not now.
- **Testing**: Vitest + React Testing Library for components (from WEB PHASE 0);
  Playwright for end-to-end flows once auth exists (from WEB PHASE 2). This is
  the deliberate "frontend/e2e test tooling" gap noted in `docs/build-plan.md`,
  now being filled.
- No global client state manager beyond TanStack Query and a React context for
  the current session.

## Cross-cutting requirements

These hold in **every** phase and are checked in every phase's review:

1. **Auth/role state matrix.** Every route explicitly defines its behavior for
   each of: anonymous, authenticated non-creator, creator (viewing their own
   area), subscriber of the creator being viewed, admin/moderator. "Redirect to
   `/login`" is a valid answer but it must be a chosen answer, not an accident.
2. **Logged-out vs logged-in shell.** The app shell renders two header/nav
   variants and must never flash the wrong one (resolve session on the server):
   - *Logged out*: wordmark · `Discover` · `Log in` · `Become a creator` (primary).
   - *Logged in*: wordmark · `Feed` · `Discover` · `Create` (if creator) ·
     avatar menu → `Dashboard` (if creator), `Subscriptions`, `Settings`,
     `Log out`.
3. **Four states per data view.** Every view that loads data ships `loading`
   (skeleton, not a bare spinner), `empty`, `error` (with retry), and — where
   applicable — `locked`. No infinite spinners.
4. **Locked content is never in the client.** Protected post body/media must not
   be sent to the browser even hidden behind CSS. The server returns
   metadata-only for locked posts; the UI renders a preview + tier badge +
   "Subscribe to unlock" CTA and nothing else.
5. **Adult/NSFW handling.** An age-confirmation gate precedes NSFW browsing,
   subscribing, and payout onboarding. NSFW media is blurred by default with an
   explicit per-item reveal. Content labels from the API are always respected.
   NSFW media never appears in OpenGraph/preview images or in logged-out
   discovery results. (Real age/identity verification is WEB PHASE 14; earlier
   phases use a self-attestation gate and mark it clearly as a placeholder.)
6. **Accessibility baseline.** Semantic landmarks, fully keyboard-operable,
   visible focus rings, focus-trapped dialogs, `prefers-reduced-motion`
   honored, WCAG AA contrast in both themes. Full audit in WEB PHASE 15.
7. **Responsive.** Mobile-first, usable from 360px wide to desktop. Feed and
   creator pages must be comfortable one-handed on a phone.
8. **No secrets in the bundle.** No private object-storage URLs, no other
   users' subscriber lists or DIDs, no provider keys. `NEXT_PUBLIC_*` is for
   non-sensitive config only.
9. **Cursor-based pagination everywhere.** All lists use infinite scroll or a
   "Load more" button driven by the API's cursor. No page-number pagers.
10. **Never build ahead of the API.** A screen is not started until the route it
    calls exists in the matching `full.md` phase.

## Per-phase exit checklist

At the end of every WEB PHASE, in addition to `full.md`'s standard checklist:

1. component tests pass (Vitest + RTL); e2e passes (Playwright, from phase 2)
2. `pnpm --filter @foryour-fans/web lint` passes with `--max-warnings=0`
3. `pnpm --filter @foryour-fans/web typecheck` passes
4. `pnpm --filter @foryour-fans/web build` (`next build`) succeeds
5. `next dev` runs and every new/changed route renders in each relevant auth state
6. README web section updated
7. `docs/ux.md` updated (screen inventory + state matrix; created in WEB PHASE 0)
8. screenshots of new screens in each auth state attached to the summary
9. files-changed summary
10. known limitations documented
11. next phase identified

Do not continue past the phase's `Stop after` line.

---

# WEB PHASE 0 — Design System & App Shell

Build the foundation every later phase renders into. No product features.

## Design tokens & theming

- Install and configure Tailwind. Define tokens as CSS variables: color
  (background, surface, text, muted, border, primary, primary-foreground,
  success, warning, danger, and a distinct `locked`/`premium` accent),
  radius, spacing scale, typography scale, shadow.
- Light and dark themes. Default to system; allow an explicit override stored in
  a cookie so SSR renders the right theme with no flash.
- One display/heading font and one body font, loaded locally (no layout shift).

## UI primitives (`apps/web/components/ui/`)

`Button` (variants: primary, secondary, ghost, destructive; loading state),
`Input`, `Textarea`, `Select`, `Switch`, `Checkbox`, `Label`, `FormField`
(label + control + error text wiring for `react-hook-form`), `Card`, `Avatar`
(with fallback initials), `Badge`, `Dialog`, `DropdownMenu`, `Tabs`, `Tooltip`,
`Toast` + a `toast()` helper, `Skeleton`, `Spinner`, `EmptyState`,
`ErrorState` (message + retry), `Pagination`/`InfiniteList` helper for
cursor-driven lists.

## App shell & routing

- Split routes into groups: `app/(marketing)/` (public site, its own minimal
  layout) and `app/(app)/` (authenticated app, shell with header + nav).
  Move the existing routes into the appropriate group.
- Build `Header` with the two variants from cross-cutting requirement #2.
  Resolve the session **on the server** (`serverApi('/me')`) so the correct
  variant is in the initial HTML — no logged-out→logged-in flicker.
- `Footer` with links to `/about`, `/discover`, `/terms`, `/privacy`, and a
  compliance placeholder page (`/legal/compliance`) — content stubbed, flagged
  for legal review, per `full.md`'s content policy.
- `SessionProvider` React context exposing `{ status, user }` for client
  components; hydrated from the server value, never re-fetched on mount just to
  populate it.
- `app/(app)/layout.tsx` redirects anonymous users to `/login?next=<path>`.
- Global `error.tsx` and refreshed `not-found.tsx` using `ErrorState`.

## Deliverables

- `docs/ux.md` created: living screen inventory + the auth/role state matrix
  (route × {anon, authed, creator, subscriber, admin}). Every later phase
  updates it.
- Storybook is **not** required; a single `/dev/components` page (dev-only,
  excluded from production build) that renders every primitive in both themes
  is enough.

Do not build the landing page content, auth screens, or any product feature yet.

Stop after WEB PHASE 0.

---

# WEB PHASE 1 — Marketing & Landing

Build the public marketing site in `app/(marketing)/`.

## Home landing page (`/`)

- **Logged-out state**: hero explaining foryour.fans — AT Protocol-native paid
  creator network, portable identity (your DID, not a username/password we own),
  public posts on the open network, paid subscriber-only content. Primary CTA
  `Continue with AT Protocol` → `/login`; secondary CTA `Become a creator`.
- Sections: "How it works" (bring your AT Protocol identity → follow/subscribe →
  access tiered content), "For creators" (tiers, keep your audience if you
  leave, adult content welcome), "Built on AT Protocol" (identity portability),
  a `Featured creators` strip (render `EmptyState` until WEB PHASE 10 provides
  discovery data — do not fake creators).
- **Logged-in state**: replace the hero with a personalized panel — greeting,
  quick links to `Feed`, `Subscriptions`, and `Dashboard`/`Become a creator`
  depending on creator status. Do not hard-redirect logged-in users away from
  `/`.
- SEO: per-route `metadata`, OpenGraph/Twitter cards, `robots`, sitemap. No
  NSFW imagery in any OG asset.

## Supporting pages

- `/about` — what the platform is and the AT Protocol rationale.
- `/terms`, `/privacy`, `/legal/compliance` — real page scaffolding, placeholder
  copy, each with a visible "pending legal review" note. Do not invent legal
  requirements (per `full.md`).
- `/discover` — a teaser shell only (heading + `EmptyState`); the real browse
  experience is WEB PHASE 10.

Marketing pages must render fully for anonymous users with no API session and
must not call authenticated endpoints.

Stop after WEB PHASE 1.

---

# WEB PHASE 2 — Auth UX

Turn the raw `/login` fetch form into a real authentication experience against
the Phase 2 API (`POST /auth/atproto/start`, `GET /auth/atproto/callback`,
`POST /auth/logout`, `GET /me`).

- `/login`: handle input with inline validation (shape of an AT handle),
  `Continue with AT Protocol` button with loading state, and specific error
  messaging for: unresolvable handle, PDS unreachable, OAuth start failure,
  user-cancelled authorization. Support `?next=` and return the user there
  after login. If already logged in, redirect to `next` or `/dashboard`.
- Callback landing route: a lightweight `/auth/callback` page that shows a
  "Finishing sign-in…" state while the API completes the exchange, then routes
  new users vs returning users appropriately (returning → `next`/`/dashboard`;
  brand-new user with no creator → `/dashboard` with a "set up your profile"
  nudge). Never expose OAuth `state`, PKCE, or DPoP details in the UI.
- Logout: wire `LogoutButton` through the CSRF header helper (already exists in
  `lib/csrf.ts`); on success clear client session context and route to `/`.
- Session expiry: a `fetch` wrapper that, on `401` from the app API, clears
  session context and redirects to `/login?next=<current>` with a toast
  ("Your session expired — please sign in again").
- Introduce Playwright; add an e2e test for the full login → `/dashboard` →
  logout round trip against the fake OAuth client already used in API tests.

Do not build creator or subscription UI.

Stop after WEB PHASE 2.

---

# WEB PHASE 3 — Viewer Account & Settings

Account management for any authenticated user (creator or not).

- `/settings` with tabs: `Account`, `Appearance`, `Notifications` (placeholder).
- `Account`: show current handle, **DID** (copyable, labelled immutable),
  display name and avatar sourced from the AT profile. "Refresh from AT
  Protocol" action to re-pull cached profile fields. Make clear which fields are
  cached from AT (handle, display name, avatar) vs owned by foryour.fans.
- `Appearance`: theme override (system/light/dark) persisted to the cookie from
  WEB PHASE 0.
- `Notifications`: render the future channels as disabled controls with a note
  that transactional email/notifications are not yet built (matches the
  deliberate gap in `docs/build-plan.md`).
- Account deactivation/delete: a placeholder section describing what will happen
  (the app cannot delete AT records in the user's own repo — it can only stop
  indexing and issue authorized deletes). No destructive action wired yet.

Stop after WEB PHASE 3.

---

# WEB PHASE 4 — Creator Onboarding & Public Creator Page

Consumes Phase 4 (`POST /creators`, `GET /creators/:identifier`,
`GET/PATCH /creators/me`).

> **Partly superseded by [`prompts/handle-identity.md`](./handle-identity.md)** (run after this phase,
> before WEB PHASE 5). The **Slug** wizard step, `@slug`, the "accepts a slug"
> identifier, and the slug-change dialog described below were **removed**: the
> public identifier is the AT handle or DID, the wizard is Profile → Content
> rating → Review, and `/c/:handle` replaces `/c/:slug`. The rest stands.

## `/become-a-creator` — onboarding wizard

Multi-step, one concern per step, with a review step:

1. **Profile** — display name, bio, website.
2. **Images** — avatar and banner uploaded as blobs to the creator's **own
   PDS** via the Phase 3 blob path. Enforce the target PDS's blob size limit
   client-side before upload; show progress and a crop/preview.
3. **Content rating** — self-attested "this account will post adult content"
   toggle, with a note that identity verification will be required before
   payouts (WEB PHASE 14).
4. **Review & publish** — on submit, create the creator and publish the
   `fans.foryour.profile` record; show which parts went to AT vs the app DB. The
   review notes the page will live at `/c/<your-handle>` (derived, not entered).

Already-a-creator users are redirected to their creator page.

## `/c/:handle` — public creator page

- Banner, avatar, display name, `@handle`, bio, website, member-since.
- Tier cards (data from WEB PHASE 5; until then render the section as
  `EmptyState`).
- Public post grid (data from WEB PHASE 9; until then `EmptyState`).
- `Subscribe` CTA (opens the flow built in WEB PHASE 6; until then a disabled
  button).
- The identifier is an AT `handle` or a `DID`. On a handle that has moved
  (API returns `301 { movedTo }` — `prompts/handle-identity.md`), the page
  server-redirects to `/c/<movedTo>`. An unknown identifier shows the friendly
  "not available" state, not a hard error.
- Renders for anonymous users. Owner sees an inline `Edit` affordance linking to
  settings.
- Respects the creator's adult-content flag: behind the age gate for
  logged-out / unconfirmed visitors.

## `/creator/settings`

Replace the raw form with the primitives: profile edit, image replacement, and a
visible indicator of AT publish status (last synced, "changes will be written to
your PDS"). A short static note explains the page address follows the AT handle
(`/c/<handle>`), changes with the identity provider / PDS, and that `/c/<did>`
never changes — there is no in-app slug/address to edit.

Ownership: a user can only ever load `/creator/settings` for their own account;
never expose another creator's edit surface.

Stop after WEB PHASE 4.

---

# WEB PHASE 5 — Tier Management

Consumes Phase 5 (`POST/GET/PATCH/DELETE /creators/.../tiers`).

- `/creator/tiers`: list of tiers with drag-to-reorder (`sortOrder`), active/
  inactive toggle, and create/edit in a `Dialog`.
- Tier form: name, description, price (minor units, entered as a currency
  amount and converted), currency selector, active flag.
- Editing price shows an explicit callout: "Changing the price does not change
  what current subscribers pay — they keep the price they signed up at. This
  only affects new subscriptions." (matches the Phase 5/6 grandfathering rule).
- Deleting a tier explains it will be **deactivated**, not destroyed, and that
  existing subscribers keep access and historical billing.
- Public tier cards on `/c/:handle` now render from this data: name, description,
  price/interval, and a per-tier `Subscribe` button (wired in WEB PHASE 6).
- Ownership-gated; `/creator/tiers` is unavailable to non-creators.

Stop after WEB PHASE 5.

---

# WEB PHASE 6 — Subscribe, Billing & Payout Onboarding

Consumes Phase 6 (fake `PaymentProvider`/`PayoutProvider`, `Subscription`
model with price snapshot, entitlement service, `POST /creators/me/payout-account`,
`GET /creators/me/payout-account/status`).

## Subscribe flow (subscriber side)

- Triggered from a tier card on `/c/:handle`. Anonymous users are sent to
  `/login?next=` back to the creator page.
- Flow: choose tier → review screen showing the exact price being locked in
  (the snapshot) and the billing interval → confirm. The UI must assume a
  **hosted-checkout redirect** model (the real processor is unknown and may be
  adult-content-specific): call the API, and if it returns a redirect URL, send
  the browser there; handle `return`/`success`/`cancel` routes
  (`/subscribe/return`) that reconcile status with the API and show the outcome.
  Do not build a card form or assume Stripe Elements.
- Post-subscribe: success state with a link to the now-unlocked creator feed.
- `/subscriptions`: the viewer's active and past subscriptions — creator,
  tier, price paid, renewal date, status badge (`pending`, `active`,
  `past_due`, `canceled`, `expired`). Actions: toggle `cancelAtPeriodEnd`,
  resubscribe. `past_due` shows a prominent "update payment" banner (which,
  again, routes to a hosted flow).

## Payout onboarding (creator side)

- `/creator/payouts`: shows payout-account status from
  `GET /creators/me/payout-account/status` as clear states — `not started`,
  `pending verification`, `verified`, `restricted`/`rejected`.
- `Start payout onboarding` calls `POST /creators/me/payout-account` and
  redirects to whatever onboarding URL the provider returns.
- Copy makes explicit that a creator can publish and receive subscriptions
  while payout is still `pending`, but real payout figures on the dashboard
  (WEB PHASE 13) are gated on `verified`.
- An age/identity-verification gate precedes starting payout onboarding
  (placeholder until WEB PHASE 14; do not allow enabling a real provider).

Stop after WEB PHASE 6.

---

# WEB PHASE 7 — Post Composer & Private Content

Consumes Phase 7 (`ContentRepository`, `Post` with `visibility`
`PUBLIC`/`SUBSCRIBERS`/`TIER`, entitlement-gated reads,
`POST/GET/DELETE /creators/.../posts`, `GET /posts/:id`).

- `/creator/posts` — the creator's own post list with visibility badges, edit,
  and delete (confirm dialog).
- `/creator/posts/new` and edit — composer with:
  - rich-enough text (plain text or minimal markdown; decided here),
  - a **visibility selector**: `Public`, `Subscribers`, `Specific tier` (with a
    tier picker for `TIER`),
  - a persistent, unmissable warning when `Public` is selected: "This publishes
    to the open AT Protocol network and can be replicated by other apps.
    Subscriber-only content never leaves foryour.fans." — enforcing the
    `full.md` rule that public and private posts have visibly different storage
    behavior,
  - a media attachment area (upload UX fully built in WEB PHASE 8; a basic
    file input placeholder is acceptable here),
  - save-as-draft and publish.
- `/c/:handle/post/:id` — single post view. For a viewer without entitlement, the
  server returns metadata only and the UI shows the locked treatment (preview,
  required-tier badge, subscribe CTA). Confirm via test that no protected text
  or media URL reaches the client for: anonymous, non-subscriber, wrong-tier.
  Creator viewing their own post always sees it.

Stop after WEB PHASE 7.

---

# WEB PHASE 8 — Media Upload & Rendering UX

Consumes Phase 8 (presigned upload URL, `GET /media/:id/access` → short-lived
signed URL, `MediaAsset` status `pending_upload`/`processing`/`ready`/`rejected`).

## Upload

- Drag-and-drop + file-picker uploader used by the composer. Per file:
  client-side validation of MIME type and max size **before** requesting a
  presigned URL, upload with a real progress bar, then poll asset status.
- Status UI: `processing` (spinner + "checking your file"), `ready` (thumbnail),
  `rejected` (reason + remove/retry). A post cannot be published while any
  attachment is not `ready`.
- Reorderable attachment list mapping to `PostMedia.sortOrder`.
- Image preview inline; video shows a poster frame and duration.

## Rendering

- Media in a post/feed is fetched through `GET /media/:id/access` on demand —
  never embed a storage URL. Signed URLs are treated as short-lived; refresh on
  expiry.
- A `MediaLightbox` for full-size viewing with keyboard nav.
- NSFW media renders blurred with a per-item "Reveal" control; the reveal
  decision is not remembered across sessions for logged-out users. NSFW media is
  excluded from any server-rendered preview/OG output.

Stop after WEB PHASE 8.

---

# WEB PHASE 9 — Feeds

Consumes Phase 9 (`GET /feed`, `GET /creators/:creator/feed`, locked-post
metadata-only responses).

- `/feed` — the home feed for logged-in users: a merged stream of public posts
  from followed/discovered creators and unlocked subscriber posts. Cursor-based
  infinite scroll. Empty state for users following no one (CTA to `/discover`).
- `/c/:handle` — the creator's own feed tab, combining their public and (for
  entitled viewers) unlocked posts, plus locked posts shown as previews.
- Post card states, visually distinct: `Public`, `Subscriber-only`, `Premium`
  (tier), `Locked` (not entitled — preview + tier + subscribe CTA), `Subscribed`
  (unlocked). A locked card must contain only the safe metadata the API returns
  (id, creator, `createdAt`, required tier, preview text/blur) — assert this in a
  test.
- `/c/:handle/post/:id` — refined from WEB PHASE 7 with comments/likes slots
  (filled in WEB PHASE 12) and next/prev navigation within the creator feed.
- Anonymous users on `/feed` get a logged-out explainer + login CTA, not an
  empty stream.

Stop after WEB PHASE 9.

---

# WEB PHASE 10 — Discovery & Search

Consumes Phase 10 (ingestion/index, `/discover`, `/search`).

- `/discover` — browse creators: sections for new, active, and by category;
  creator cards (avatar, name, `@handle`, short bio, tier count / from-price).
  NSFW creators are hidden for logged-out/unconfirmed visitors and gated behind
  the age confirmation otherwise, with a user toggle to include/exclude adult
  creators (default exclude).
- `/search` — search by creator name, handle, or bio. Debounced input, cursor
  paginated results, clear "no results" state, recent searches (local only).
- All creator links resolve by a DID-stable identifier so they survive handle
  changes (per `full.md` Phase 10).
- The `Featured creators` strip on `/` (stubbed in WEB PHASE 1) now renders real
  data.
- Handle deletions/tombstones upstream: a creator removed from the index simply
  stops appearing; a direct visit to a de-indexed `/c/:handle` shows a "this
  creator is no longer available" state, not a stack trace.

Stop after WEB PHASE 10.

---

# WEB PHASE 11 — (vacated) Spaces

The Spaces UI work that used to live here has been **moved to
[`prompts/atproto-spaces.md`](./atproto-spaces.md)** and runs **dead last** —
after `WEB PHASE 12`–`17` and after both rearchitecture phases.

This slot is intentionally left vacant rather than renumbered, so every
`WEB PHASE 12`–`17` cross-reference still resolves. There is no `WEB PHASE 11`
work in this file.

Continue to `WEB PHASE 12`.

---

# WEB PHASE 12 — Comments & Likes

Consumes Phase 12 (`Comment`, `Like`, access inherited from the parent post,
`POST/GET /posts/:id/comments`, `POST/DELETE /posts/:id/likes`).

- Comment thread on `/c/:handle/post/:id`: list (cursor paginated), composer for
  entitled viewers, creator's own comments badged. A locked post shows **no**
  comment thread and no composer — access is inherited from the post.
- Like button with optimistic toggle and rollback on error; like count;
  "liked by creator" indicator.
- Entry points for reporting a comment (dialog wired in WEB PHASE 14).
- Rate-limit responses from the API surface as a friendly "you're doing that too
  fast" toast, not a generic error.

Stop after WEB PHASE 12.

---

# WEB PHASE 13 — Creator Dashboard

Consumes Phase 13 (ownership-protected analytics; numbers come from the billing
DB, never from AT Protocol).

- `/creator/dashboard`: subscriber count, active subscriptions, MRR, revenue by
  tier, new subscribers, cancellations, recent posts. Date-range filter
  (presets + custom).
- Charts for MRR-over-time and subscribers-over-time; tier revenue as a
  breakdown. Pick the chart lib here.
- Revenue figures use the **price snapshot** from Phase 6, not live tier prices.
- A payout-status widget (from WEB PHASE 6); if payout is not `verified`, real
  payout amounts are replaced with a "complete payout onboarding to see
  earnings" prompt.
- Every dashboard endpoint call is ownership-checked; a non-owner hitting
  `/creator/dashboard` gets a 403 treatment, not another creator's data.
- Empty/new-creator state with guidance (publish a post, create a tier, finish
  payout onboarding).

Stop after WEB PHASE 13.

---

# WEB PHASE 14 — Trust & Safety UX + Admin Console

Consumes Phase 14 (`Report`, `ModerationCase`, `ContentLabel`, `UserBlock`,
`CreatorBlock`, `AuditLog`, creator verification-status field).

## User-facing

- Report dialogs for creator, post, and comment: reason picker + free text,
  confirmation, no exposure of case internals.
- Block user / block creator, and a `/settings/blocks` management list.
- **Age verification** flow: replaces the self-attestation placeholder from
  earlier phases. Status states surfaced wherever gated (subscribe to adult
  creators, view adult discovery). Do not integrate a specific vendor — build
  the UI against the API's status field.
- **Creator identity / KYC verification** flow: `/creator/verification` with
  status `unverified` / `pending` / `verified` / `rejected`. Posting a
  tier/post marked adult, and payout onboarding, are **blocked in the UI**
  until `verified` — matching the `full.md` gating requirement.
- Content-label display: labelled content is collapsed/blurred with a
  "show anyway" control; some labels (per API) are not user-dismissible.
- Moderation-notice banners on restricted/removed content the viewer owns, with
  a placeholder appeal link.

## Admin/moderation console (`/admin`, role-gated)

- Separate area, only reachable by admin/moderator role; anyone else gets a 404
  (not a 403 that confirms the route exists).
- Report queue with filters, case detail view, and actions: restrict account,
  remove content, suspend creator, add/remove content label. Every action
  requires a reason and writes to the audit log.
- Audit-log viewer (read-only).
- Interfaces for automated classifiers are represented as pluggable "signal"
  rows in the case view, not a hard-coded provider.

Document every place legal/compliance review is required (do not invent
requirements). Note in `docs/ux.md` that transactional notices (moderation
emails, receipts) are still out of scope.

Stop after WEB PHASE 14.

---

# WEB PHASE 15 — Polish, Accessibility, Performance & Error Handling

Hardening pass. No new product features.

- **Errors**: audit every route for `loading`/`empty`/`error`/`locked`
  coverage; per-segment `error.tsx` and `loading.tsx`; a global fetch failure /
  offline treatment; toasts for transient failures; friendly `404`/`403`/`500`.
- **Accessibility**: full keyboard pass, focus management on route change and in
  dialogs, ARIA on custom widgets, `prefers-reduced-motion`, AA contrast in both
  themes, screen-reader smoke test of the core flows (login, subscribe,
  view locked post, comment). Fix findings.
- **Performance**: image strategy (sizing, lazy-loading, `next/image` config or
  a documented decision to keep plain `<img>`), route-level code splitting,
  bundle-size check (no server-only packages like Prisma/ioredis in a client
  bundle — this is already a known hazard, see `lib/csrf.ts`), TanStack Query
  cache tuning, Lighthouse targets for `/`, `/c/:handle`, `/feed`.
- **Responsive**: dedicated mobile pass on feed, creator page, composer,
  dashboard, admin.
- **Metadata**: correct `metadata`/OG per route; verify no NSFW media leaks into
  any OG image or logged-out surface.
- Produce `docs/ux.md` final screen inventory + state matrix and a short
  `docs/web-accessibility.md` with the audit results.

Stop after WEB PHASE 15.

---

# WEB PHASE 16 — Web Deployment & Build Config

Consumes Phase 16 (Kubernetes manifests).

- `next build` with `output: "standalone"`; multi-stage `Dockerfile` for
  `apps/web` under `infrastructure/docker/`.
- Environment config: document every `NEXT_PUBLIC_*` (non-sensitive only) and
  every server-only var (`API_INTERNAL_URL`, session/theme cookie names). Typed
  config module mirroring the API's approach.
- Security headers from the web tier: CSP compatible with the `/api/*` proxy and
  with signed media URLs, `Referrer-Policy`, `X-Content-Type-Options`,
  `frame-ancestors`, HSTS in production. Coordinate with the API's headers so
  they don't conflict.
- Add the web Deployment/Service/Ingress to the k8s base + overlays from
  `full.md` Phase 16, with readiness/liveness probes (a `/healthz` route in the
  app) and resource requests/limits. No secrets committed.
- CI: extend the existing GitHub Actions workflow to lint/typecheck/test/build
  the web app and run the Playwright suite headless.

Stop after WEB PHASE 16.

---

# WEB PHASE 17 — UX Review

No new features. Review the whole web app.

Produce `docs/ux-review.md` containing:

- **Screen inventory**: every route, its purpose, and the components it owns.
- **State matrix**: every route × { anonymous, authenticated non-creator,
  creator, subscriber-of-viewed-creator, admin/moderator } — with the intended
  behavior in each cell and whether it is implemented, stubbed, or missing.
- **Flow diagrams** for: login → session, subscribe → hosted checkout → unlock,
  compose → upload → publish (public vs private), report → moderation case.
- **Risk list**: accessibility gaps, places the client could over-fetch
  protected data, NSFW-leak surfaces, payment-provider coupling in the UI,
  handle-vs-DID assumptions, SSR/session-flicker risks.
- **MVP-readiness classification**, mirroring `full.md` Phase 17:
  `Ready for MVP` / `Needs work before MVP` / `Future work` / `Experimental`.

Make only changes needed to fix material UX or security problems found in the
review. Do not refactor for style.

Stop after WEB PHASE 17.
