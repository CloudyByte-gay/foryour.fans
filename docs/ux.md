# Web UX — Screen Inventory & State Matrix

Living companion to [`prompts/web.md`](../prompts/web.md). Every `WEB PHASE`
updates this file: add rows as routes appear, fill in the state cells as
behavior is implemented, and move items out of "Planned / not yet built" as
they ship.

**Status: WEB PHASE 9 complete** (WEB PHASE 4 was amended by the
Handle-as-Identity refactor,
[`prompts/handle-identity.md`](../prompts/handle-identity.md)).
WEB PHASES 0–3 (design system, app shell, marketing, auth UX, `/settings`),
plus creator onboarding: the multi-step `/become-a-creator` wizard (profile,
self-attested content-rating placeholder, review → `POST /creators`), the
public `/c/[handle]` page (segment is an AT handle or a DID, owner Edit
affordance, public tier cards, `EmptyState` for posts, and a `308` redirect
to the current handle when a former one is visited), a rebuilt
`/creator/settings` whose page-address card is a static note (the address
follows your AT handle — there is no in-app slug to change),
**tier management**: `/creator/tiers` (drag-to-reorder, active/inactive
toggle, create/edit dialog, deactivate-not-delete confirmation, price
grandfathering callout), and **subscribe / billing / payouts** (WEB PHASE 6):
a per-tier subscribe review dialog on `/c/[handle]` → `POST
/creators/:id/subscribe` → the browser follows the provider's
hosted-checkout `redirectUrl` → `/subscribe/return` reconciles the outcome
against `GET /subscriptions` (never a synchronous "subscribed"); a
`/subscriptions` page (price snapshot, renewal date, status badge, cancel-at-
renewal toggle, resubscribe, past-due banner); and `/creator/payouts`
(status states from `GET /creators/me/payout-account/status`, a self-declared
age/identity gate before `POST /creators/me/payout-account`, then the
provider's hosted onboarding redirect). **No API change in WEB PHASE 6** —
the Phase 6 API (fake `PaymentProvider`/`PayoutProvider`, subscribe/webhook/
payout routes) already existed. The Playwright fake API
(`apps/api/test/e2e/fakeServer.ts`) gained a seeded second creator + stub
hosted-checkout/onboarding routes so the redirect round trip is testable.

**WEB PHASE 7** adds the **post composer & private content**: `/creator/posts`
(the creator's own list — visibility badge, edit, delete-with-confirm),
`/creator/posts/new` + `/creator/posts/:id/edit` (`PostComposer`: plain-text
body, `Public`/`Subscribers`/`Specific tier` selector with a tier picker, and
the persistent non-dismissible warning shown only while `Public` is selected),
and `/c/:handle/post/:id` (the public permalink — full `PostArticle` for an
entitled viewer / creator / any `PUBLIC` post, `LockedPostCard` for everyone
else, built only from the API's locked stub). **API touch:** new
`PATCH /creators/me/posts/:id` (thin wrapper over the existing
`ContentRepository.updatePost`), and `GET /posts/:id` now returns a `200`
locked stub (`locked: true`, `requiredTier`, `hasMedia`, never `text`/`media`)
for a non-entitled viewer instead of `403`, plus the creator's public identity
on both branches. No draft state (the `Post` model has no field for it — the
composer publishes on save; documented placeholder).

**WEB PHASE 8** adds **media upload & rendering** (`components/media/*`,
`lib/media.ts`): the composer's `MediaUploader` (drag-and-drop + file picker,
client MIME/size validation before any presigned URL, a real progress bar on
the direct-to-storage `PUT`, a `processing → ready/rejected` status poll, a
`@dnd-kit`-reorderable list → `PostMedia.sortOrder`; **Publish** is disabled
until every attachment is `ready`), and on-demand media rendering on post
views (`useSignedMedia` → `GET /media/:id/access`, `MediaGallery` +
keyboard-navigable `MediaLightbox`, `MediaThumb` on feed cards, NSFW
blur-by-default with a per-item reveal — mechanism only, no label API before
WEB PHASE 14). **API touch:** `POST`/`PATCH /creators/me/posts` accept
`media: [{mediaAssetId, sortOrder}]` (validated by `resolvePostMedia`);
`GET /media/:id/access` now follows the attached post's entitlement instead
of "any active subscriber"; new owner-only `GET /media/:id` status route.

**WEB PHASE 9** (Feeds) builds on the feed surfaces `bluesky-public-posts.md`'s
web half already shipped early (`FeedList`, `CreatorFeed`, `PostCard`,
`lib/post.ts#postBadges`, `LockedPostCard`) and closes the three gaps the
phase spec calls out against them:

- `/feed` moves from the `(app)` group to `(marketing)` — an anonymous visit
  is now a *chosen* answer (a `FeedLoggedOut` explainer + `Log in`/`Browse
  creators` CTAs), not the `(app)` group's `/login?next=` redirect and not the
  real (PUBLIC-only) stream the API would actually serve one. The empty state
  for a signed-in visitor with nothing in their feed now links to `/discover`.
- `postBadges()` gains a **Subscribed** badge on an unlocked `SUBSCRIBERS`/
  `TIER` post for a non-owner viewer (`viewerIsOwner` param, threaded through
  `PostCard` from `CreatorFeed`'s existing `isOwner`) — the fifth of the
  spec's five distinct card states (`Public`, `Subscriber-only`, `Tier`,
  `Locked`, `Subscribed`) was the only one missing a visible marker; the other
  four were already distinct via badge label + body presence.
- `/c/[handle]/post/[id]` gets prev/next navigation within the creator's feed
  (`lib/post.ts#findFeedNeighbors`, a pure array-scan over one page —
  `limit=50` — of `GET /creators/:id/feed`; a post older than that window
  just gets no nav, an accepted degradation over an unbounded cursor walk).
  Rendered by both `PostArticle` and `LockedPostCard` — a locked post can
  still be skipped past.

No API changes — WEB PHASE 9 consumes `GET /feed` and
`GET /creators/:identifier/feed` exactly as Phase 9 shipped them.

## Legend

State columns are the five audiences from cross-cutting requirement #1:

| Key | Audience |
|-----|----------|
| **anon** | not logged in, no API session |
| **authed** | logged in, no creator account |
| **creator** | logged in, owns a creator account (viewing their own area) |
| **sub** | logged in, subscribed to the creator being viewed |
| **admin** | logged in with an admin/moderator role |

Cell values: ✅ implemented · 🚧 stubbed / placeholder · ⛔ intentionally
blocked (redirect / 404) · — not applicable · ⬜ planned, not built.

## Route groups

- `app/(marketing)/` — public site. Own layout: `Header` + `Footer`, renders
  fully for **anon**, never requires an API session. The `Header` still shows
  its logged-in variant when a session happens to exist. `/c/[handle]` and
  `/feed` (WEB PHASE 9) live here too even though most of their content needs
  a session — each branches on `getSession()` itself rather than being gated
  by the group, because an anonymous visit to either is a deliberately
  designed state (a public creator page; a feed explainer), not a redirect.
- `app/(app)/` — authenticated app. `app/(app)/layout.tsx` redirects **anon**
  to `/login?next=<path>` (the path comes from the `x-pathname` request header
  set in `middleware.ts`).
- Top level (`app/`) — `layout.tsx` (html shell, fonts, `Providers`,
  `ThemeScript`), `error.tsx`, `not-found.tsx`, `auth/callback/` (post-OAuth
  landing, no shell chrome).

## Auth flow (WEB PHASE 2)

```
/login  ──POST /api/auth/atproto/start──▶  authorization server
   │  (stashes a safe `next` in sessionStorage: ff.postLoginNext)
   ▼
/api/auth/atproto/callback  (API: token exchange, sets ff_session + ff_csrf)
   │  success ─302─▶ <PUBLIC_URL>/auth/callback
   │  AS error / exchange failure ─302─▶ <PUBLIC_URL>/auth/callback?error=<code>
   ▼
/auth/callback  ("Finishing sign-in…")
   ├─ error=access_denied            → "Sign-in cancelled" + back-to-login
   ├─ error=<other>                  → "Sign-in didn't finish" + retry
   ├─ stored `next`                  → window.location.replace(next)
   ├─ no creator (GET /creators/me)  → /dashboard?welcome=1  (setup nudge)
   └─ otherwise                      → /dashboard
```

- **API changes so far in the web track:**
  - WEB PHASE 2 — `GET /auth/atproto/callback` now 302s to
    `<PUBLIC_URL>/auth/callback` (success) or `…/auth/callback?error=<code>`
    (AS error / exchange failure), instead of `/dashboard` + a JSON `400`.
  - WEB PHASE 3 — new `POST /me/refresh` (`requireSession` + `requireCsrf`):
    `oauthClient.restore(did)` → `fetchProfile` → `syncUserFromProfile`,
    returns the updated `/me` shape (`502` if the PDS can't be reached). Reuses
    the exact path the OAuth callback runs at login; the DID is never touched.
  - WEB PHASE 5 — new `GET /creators/me/tiers` (`requireSession`) returns the
    caller's tiers **including deactivated ones** (the public
    `GET /creators/:identifier/tiers` stays active-only); new
    `POST /creators/me/tiers/:tierId/reactivate` (`requireSession` +
    `requireCsrf`) re-publishes a deactivated tier's `fans.foryour.tier` record
    and flips `isActive` back on — the inverse of `DELETE`. Domain logic
    (`listAllTiers`, `reactivateTier`) lives in `packages/subscriptions`;
    `apps/api` + package tests added.
  - WEB PHASE 7 — new `PATCH /creators/me/posts/:id` (`requireSession` +
    `requireCsrf`): a thin wrapper over the already-shipped
    `ContentRepository.updatePost` (spec's Phase 7 route list has no PATCH, but
    the composer has an edit mode), same TIER validation as `POST`. And
    `GET /posts/:id` changed: a non-entitled viewer (anonymous, non-subscriber,
    wrong tier) now gets a `200` locked stub
    (`{ id, creatorId, visibility, createdAt, locked: true, hasMedia, requiredTier }`
    — never `text`/`media`) instead of `403`, and both branches carry the
    creator's public identity (`{ did, handle, displayName }`). `toLockedStub`
    moved from `routes/feed.ts` to `routes/posts.ts` and is shared (it is the
    same shape Phase 9's `GET /creators/:identifier/feed` already returns).
  Auth semantics, cookies and session storage are otherwise unchanged;
  `apps/api` tests updated / added for each.
- **Session expiry:** `lib/apiFetch.ts` wraps `fetch` for client-side calls to
  `/api/*`; a `401` clears the session context (`emitSessionCleared()` →
  `SessionProvider`), shows a "Your session expired" toast, and redirects to
  `/login?next=<current>`. It is the pattern for authed client fetches from
  WEB PHASE 3 on.
- **`next` safety:** `lib/nav.ts#isSafeInternalPath` — only same-site paths,
  never `//…`, `/api…` or `/auth/…` (open-redirect guard), applied on both the
  login "already signed in" redirect and the callback routing.

## Screen inventory & state matrix

### Shipped

| Route | Group | Purpose | anon | authed | creator | sub | admin | Owns |
|-------|-------|---------|------|--------|---------|-----|-------|------|
| `/` | marketing | Landing: logged-out **hero** + How it works / For creators / Built on AT Protocol / Featured creators (`EmptyState`); logged-in **personalized panel** in place of the hero, **no redirect** | ✅ hero | ✅ panel | ✅ panel (+dashboard link) | ✅ panel | ✅ panel | `(marketing)/page.tsx`, `components/marketing/*` |
| `/about` | marketing | What the platform is + AT Protocol rationale | ✅ | ✅ | ✅ | ✅ | ✅ | `(marketing)/about/page.tsx` |
| `/terms` | marketing | Placeholder ToS, `noindex`, visible "pending legal review" note | ✅ | ✅ | ✅ | ✅ | ✅ | `(marketing)/terms/page.tsx` + `components/marketing/LegalPage.tsx` |
| `/privacy` | marketing | Placeholder privacy policy (same scaffold) | ✅ | ✅ | ✅ | ✅ | ✅ | `(marketing)/privacy/page.tsx` |
| `/legal/compliance` | marketing | Placeholder compliance page (same scaffold) | ✅ | ✅ | ✅ | ✅ | ✅ | `(marketing)/legal/compliance/page.tsx` |
| `/discover` | marketing | Teaser shell only (heading + `EmptyState`); real browse = WEB PHASE 10 | 🚧 | 🚧 | 🚧 | 🚧 | 🚧 | `(marketing)/discover/page.tsx` |
| `/login` | marketing | Handle form: shape validation, specific start-error copy, loading state, stores `next`. **authed → redirect** to `next` or `/dashboard`. | ✅ | ⛔ →`next`/`/dashboard` | ⛔ →`next`/`/dashboard` | — | ⛔ →`next`/`/dashboard` | `(marketing)/login/page.tsx` + `LoginForm.tsx` |
| `/auth/callback` | — (root layout) | "Finishing sign-in…" → routes new vs returning users, honors stored `next`, shows friendly copy for `?error` (cancel / failure). No OAuth internals in the UI. | ✅ (error copy) | ✅ | ✅ | ✅ | ✅ | `app/auth/callback/*` |
| `/settings` | app | Tabs `Account` / `Appearance` / `Notifications` (`?tab=` deep-links). Account: profile fields tagged **Cached from AT Protocol**, DID tagged **immutable** with a `CopyButton`, **Refresh from AT Protocol** (`POST /me/refresh`), inert deactivation card. Appearance: system/light/dark → `ff_theme` cookie (live). Notifications: disabled channel switches + gap note. | ⛔ →`/login?next=%2Fsettings` | ✅ | ✅ | ✅ | ✅ | `app/(app)/settings/*` |
| `/become-a-creator` | app | 3-step wizard: **Profile** (displayName/bio/website), **Content rating** (self-attest 18+ → adult toggle; *not persisted*, placeholder), **Review** (what goes to AT `fans.foryour.profile` vs the app DB; the page address is `/c/<your-handle>`, derived from the session — not entered) → `POST /creators` (profile fields only). | ⛔ →`/login?next=` | ✅ | ⛔ → `/c/<handle>` | ✅ | ✅ | `app/(app)/become-a-creator/*` |
| `/c/[handle]` | marketing | Public page. Segment is an AT **handle** or a URL-encoded **DID**. Avatar/banner render from foryour.fans site-only overrides when present, otherwise cached Bluesky profile images; a gradient/initials fallback covers missing images. displayName, `@handle`, bio, website, "member since". Active tier cards from `GET /creators/:identifier/tiers` (name, description, price/month). **Non-owner** each tier has a live `Subscribe` (`components/creator/SubscribeButton.tsx`): **anon** → `/login?next=/c/<addr>`; **authed** → review `Dialog` (locked-in price + grandfather note) → `POST /creators/:identifier/subscribe`. `EmptyState` when none. A **Posts** tab (`CreatorFeed`) hits the cursor-paginated `GET /creators/:identifier/feed` — every post the creator has, newest first; one a non-entitled viewer can't read comes back as a locked stub and renders as a `PostCard` with a "Locked" badge + subscribe copy, never omitted. `EmptyState` (owner: "your public posts will show up here"; visitor: "check back later") when the creator has posted nothing at all. **Owner** sees an `Edit` link + a `Manage tiers` link (compares `session.user.did` to the creator's DID) and no Subscribe. `GET /creators/:identifier` `200` → render; `301 {movedTo}` (a former handle) → server `permanentRedirect('/c/<movedTo>')`; `404` → friendly "not available" state, not a stack trace. Tier fetch failure degrades to "no tiers", never errors the page. | ✅ (Subscribe→login) | ✅ | ✅ (own page: Edit + Manage tiers) | ✅ (409→`/subscriptions`) | ✅ | `app/(marketing)/c/[handle]/page.tsx`, `components/creator/{TierCard,SubscribeButton}.tsx` |
| `/creator/settings` | app | Profile edit (`PATCH /creators/me`, "last saved" from `updatedAt`, "published to your PDS" copy), an avatar/banner card noting Bluesky fallbacks and pending upload controls, a **Membership tiers** card linking to `/creator/tiers`, a **Payouts** card linking to `/creator/payouts`, and a **Page address** card — a static note that the address follows your AT Protocol handle (change it with your PDS; old links redirect; `/c/<did>` never changes). No slug dialog. Ownership by construction (`/creators/me` is always the caller). | ⛔ →`/login?next=` | ⛔ → `/become-a-creator` | ✅ | — | — | `app/(app)/creator/settings/*` |
| `/subscriptions` | app | The viewer's own subscriptions from `GET /subscriptions`, newest first. Per row: creator (link to `/c/<addr>`), tier name, **snapshot** price (`priceCentsAtSubscription`, not the live tier price), status `Badge` (`pending`/`active`/`past_due`/`canceled`/`expired`), and a timing line (`Renews <date>` / `Cancels — access until <date>` / `Waiting for payment confirmation` / `Access ended <date>`). `active`/`past_due`/`pending` show a **Cancel at renewal** `Switch` → optimistic `PATCH /subscriptions/:id {cancelAtPeriodEnd}`, reverts + toasts on failure. `canceled`/`expired` show **Resubscribe** → `/c/<addr>` (a new row + new price snapshot, not a resume). `past_due` shows a red banner; the "update payment method" button is a **disabled placeholder** — the provider payment-portal route isn't in the Phase 6 API. `EmptyState` (→`/discover`) when none; `loading.tsx` skeleton. Ownership by construction. | ⛔ →`/login?next=%2Fsubscriptions` | ✅ | ✅ | ✅ | ✅ | `app/(app)/subscriptions/*`, `lib/subscriptions.ts` |
| `/subscribe/return` | app | Landing after the hosted-checkout redirect. Client-only: reads a `{address, creatorName, subscriptionId}` context stashed in `sessionStorage` before the redirect, then **polls `GET /subscriptions`** (≤6×, 1.5s) to reconcile — `ACTIVE` → success (link to the unlocked creator + `/subscriptions`), still `PENDING` after the retries → "payment processing" + manual "Check again", `PAST_DUE`/`CANCELED`/missing → "didn't go through, you weren't charged". Fetch failure → error + retry. `noindex`, `force-dynamic`. There is no synchronous "subscribed" path — matches the fake `PaymentProvider`. | ⛔ →`/login?next=` | ✅ | ✅ | ✅ | ✅ | `app/(app)/subscribe/return/*` |
| `/subscribe/cancel` | app | Static "checkout cancelled — nothing was charged, no subscription started" + links to `/discover` and `/subscriptions`. The provider redirects here when the visitor backs out. `noindex`. | ⛔ →`/login?next=` | ✅ | ✅ | ✅ | ✅ | `app/(app)/subscribe/cancel/page.tsx` |
| `/creator/payouts` | app | Payout onboarding. `GET /creators/me/payout-account/status` (`404` → **not started**) → one of four states: `NOT_STARTED` / `PENDING` ("pending verification") / `VERIFIED` / `RESTRICTED`. `NOT_STARTED`/`RESTRICTED` show a **self-declared 18+/identity `Checkbox`** (placeholder until WEB PHASE 14) gating a **Start / Restart payout onboarding** button → `POST /creators/me/payout-account` → `window.location.assign(onboardingUrl)` (external), else re-render with the returned status. `PENDING` shows a manual **Refresh status** button; status is also re-polled on window `focus` (no payout webhook exists — the `GET` re-checks live). Copy states subscriptions work while pending; real payout figures need `VERIFIED` and land on the dashboard (WEB PHASE 13). `loading.tsx` skeleton. Ownership by construction; not-a-creator → `/become-a-creator`. **With the fake provider only `NOT_STARTED` and `PENDING` are reachable** (`VERIFIED`/`RESTRICTED` need a real provider). | ⛔ →`/login?next=%2Fcreator%2Fpayouts` | ⛔ → `/become-a-creator` | ✅ | — | — | `app/(app)/creator/payouts/*` |
| `/creator/tiers` | app | Tier management. `GET /creators/me/tiers` (active **and** deactivated). Active tiers in a drag-to-reorder list (`@dnd-kit`, keyboard-operable; each moved row `PATCH`es its `sortOrder`); a per-row `Switch` toggles active/inactive — **off** opens a "deactivated, not deleted — existing subscribers keep access" confirm `Dialog` → `DELETE`; **on** → `POST …/reactivate`. `New tier` / row `Edit` open a `Dialog` (name, description, price entered in major units → minor, currency `usd`/`eur`/`gbp`); editing a price shows the grandfathering callout. `502` → "saved, but publishing to the AT network failed". `EmptyState` when the creator has no tiers at all. Ownership by construction. | ⛔ →`/login?next=%2Fcreator%2Ftiers` | ⛔ → `/become-a-creator` | ✅ | — | — | `app/(app)/creator/tiers/*`, `lib/tier.ts` |
| `/creator/posts` | app | The creator's own posts (`GET /creators/:me/posts` with the owner session → all of them, newest first). Per row: visibility `Badge` (`Public`/`Subscribers`/`Specific tier`), relative time, 2-line text preview, `Edit` link, `Delete` → confirm `Dialog` → `DELETE /creators/me/posts/:id` (optimistic remove). `EmptyState` + "New post" when none. Ownership-gated like `/creator/tiers`. | ⛔ →`/login?next=%2Fcreator%2Fposts` | ⛔ → `/become-a-creator` | ✅ | — | — | `app/(app)/creator/posts/*`, `lib/post.ts` |
| `/creator/posts/new`, `/creator/posts/:id/edit` | app | `PostComposer`. Plain-text body (line breaks kept, never HTML/markdown; char counter). Visibility selector `Public` / `Subscribers` / `Specific tier` — `TIER` reveals a tier `Select` (`GET /creators/me/tiers`; a since-deactivated tier already on the post stays selectable; no active tiers → link to `/creator/tiers`). **Persistent, non-dismissible warning** while `Public` is selected (the exact mandated copy). `MediaUploader` (drag-drop + picker; per-file client MIME/size check → presigned `PUT` with progress → `processing` spinner → `ready` thumbnail / `rejected` reason + remove; `@dnd-kit`-reorderable → `sortOrder`; **Publish disabled until every attachment is `ready`**; edit mode seeds from the post's `media`). Submit → `POST` / `PATCH /creators/me/posts/:id` (with `media` refs) → toast → `/creator/posts`. `502` → "saved, but publishing to the AT network failed". Edit seeds from `GET /posts/:id` (owner → full post); a non-owner / locked view → `notFound()`. No draft state (no `Post` field — publishes on save). | ⛔ →`/login?next=` | ⛔ → `/become-a-creator` | ✅ | — | — | `app/(app)/creator/posts/{new,[id]/edit}/*`, `PostComposer.tsx` |
| `/c/[handle]/post/[id]` | marketing | Single post permalink. `GET /posts/:id`. **Entitled viewer / creator / any `PUBLIC` post** → `PostArticle` (visibility badge, time, whitespace-preserved text, `MediaGallery` — signed-URL images/videos via `GET /media/:id/access`, click → `MediaLightbox` with arrow-key nav, NSFW blur + reveal — back-link; a "not on the AT network" note for non-public). **Everyone else** → `LockedPostCard`, rendered only from the API's `200` locked stub (id, creator, `createdAt`, visibility, `requiredTier`, `hasMedia`) — no body text or media ref reaches the client, and `/media/:id/access` 403s the bytes too (unit + e2e assert this). Subscribe CTA: authed → `/c/<addr>#tiers-heading`, anon → `/login?next=/c/<addr>`. A segment that is neither the creator's handle nor DID → `redirect` to the canonical address. Non-`PUBLIC` and locked pages are `noindex`; `404` → `not-found`. **Newer/Older `PostNav`** (WEB PHASE 9) at the bottom of both `PostArticle` and `LockedPostCard`: server-side `findFeedNeighbors` locates the post within one page (`limit=50`) of the creator's feed; a post outside that window gets no nav. | ✅ (locked treatment) | ✅ | ✅ (own post: full) | ✅ (entitled: full) | ✅ | `app/(marketing)/c/[handle]/post/[id]/page.tsx`, `components/creator/{PostArticle,LockedPostCard}.tsx`, `components/post/PostNav.tsx` |
| `/feed` (WEB PHASE 9) | marketing | Home feed. **anon** → `FeedLoggedOut` explainer (`Log in` / `Browse creators`), no `/feed` call made. **authed** → `GET /feed?limit=20` (PUBLIC posts platform-wide + posts from creators the viewer actively subscribes to, deduped — see `apps/api/src/routes/feed.ts`; limit-only, no cursor, by design), rendered as `PostCard`s; **Load more** re-fetches at `limit+20`. `EmptyState` → `/discover` when nothing qualifies. | ✅ (explainer) | ✅ | ✅ | ✅ | ✅ | `app/(marketing)/feed/*` |
| `/dev/components` | — | Every `components/ui` primitive in both themes. **Dev only** — `notFound()` in a production build. | 🚧 | 🚧 | 🚧 | 🚧 | 🚧 | `app/dev/components/*` |
| `/sitemap.xml`, `/robots.txt` | — | SEO. Sitemap lists `/`, `/about`, `/discover`; robots disallows the app/auth/api/dev paths | ✅ | ✅ | ✅ | ✅ | ✅ | `app/sitemap.ts`, `app/robots.ts` |
| `/opengraph-image` | — | Default OG/Twitter card — **text only, brand-controlled, never any user or NSFW imagery** (requirement #5) | ✅ | ✅ | ✅ | ✅ | ✅ | `app/opengraph-image.tsx` |
| `*` (unmatched) | — | `not-found.tsx` — `EmptyState` + link home | ✅ | ✅ | ✅ | ✅ | ✅ | `app/not-found.tsx` |
| render error | — | `error.tsx` — `ErrorState` with `reset()` | ✅ | ✅ | ✅ | ✅ | ✅ | `app/error.tsx` |

> Every marketing page renders fully for **anon** with no API session, except
> `/feed` (WEB PHASE 9): its page component checks `getSession()` first and,
> when authenticated, hits `GET /feed` — an anonymous visitor never triggers
> that call, only the shell's own `getSession()` (`/me`, 401 → anonymous). The
> `Featured creators` strip is a static `EmptyState` (no fetch yet);
> `loading`/`error` states are added when WEB PHASE 10 wires real data.

### Still pre-design-system

| Route | Group | anon | authed | creator | sub | admin | Restyled in |
|-------|-------|------|--------|---------|-----|-------|-------------|
| `/dashboard` | app | ⛔ →`/login?next=` | ✅ (profile card, `?welcome=1` nudge, logout) | ✅ (+ creator links) | — | ✅ | full dash = WEB PHASE 13 |

> Note: `/dashboard`, `/settings`, `/creator/settings` and `/c/[handle]`'s
> `generateMetadata` still throw (→ `error.tsx`) if the API is unreachable
> *after* the `(app)` layout has confirmed a session — those server fetches
> have no fallback. Non-issue with the API up; the loading/error pass is
> WEB PHASE 15.

### Planned / not yet built

Nav links in the shell already point at some of these; until their phase they
resolve to `not-found.tsx`. This is a chosen phase boundary, tracked here.

| Route | First built in | Notes |
|-------|----------------|-------|
| `/discover` (real browse) | WEB PHASE 10 | teaser shell shipped in WEB PHASE 1; real sections/search/NSFW gating later |
| `/creator/dashboard` | WEB PHASE 13 | avatar-menu link (creator only) |
| `/creator/verification` | WEB PHASE 14 | KYC status; gates adult posting + payouts |
| `/settings/blocks` | WEB PHASE 14 | |
| `/admin/*` | WEB PHASE 14 | role-gated; non-admins get **404**, not 403 |
| `/healthz` | WEB PHASE 16 | readiness/liveness probe |
| `/dev/spaces` | [`prompts/atproto-spaces.md`](../prompts/atproto-spaces.md) | dev-only diagnostics, behind `ATPROTO_SPACES_ENABLED`; Spaces extracted from WEB PHASE 11, runs dead last |

## App shell contract (requirement #2)

| Variant | Header contents |
|---------|-----------------|
| Logged out | wordmark · `Discover` · `Log in` · **`Become a creator`** |
| Logged in | wordmark · `Feed` · `Discover` · `Create` *(creator only)* · avatar menu |
| Avatar menu | `Dashboard` *(creator only)* · `Subscriptions` · `Settings` · `Log out` |

The session is resolved on the server (`lib/session.ts` → `getSession()`,
`cache()`-deduped) and passed into `Header` as a prop, so the correct variant
is in the first HTML — there is no logged-out → logged-in flash.

## Theming (requirement #6)

- Tokens are CSS variables in `app/globals.css` (`:root` / `.dark`), mapped to
  Tailwind names in `tailwind.config.ts`. Includes a distinct `locked`
  (premium / subscriber-only) accent.
- Default follows the OS. An explicit override is stored in the `ff_theme`
  cookie; SSR stamps `class="dark"` on `<html>` for an explicit dark choice,
  and `ThemeScript` (inline, pre-paint) covers the `system` case with no flash.
- The user-facing control is `/settings` → Appearance (system / light / dark),
  applied live via `ThemeProvider` and persisted to `ff_theme` (per-browser).

## Out of scope for every web phase

These OnlyFans-style features are **not** built anywhere in `prompts/web.md`
and have no routes or nav entries. Adding one means a new `prompts/full.md`
phase first, then a new `web.md` phase — never a scope expansion.

- direct messaging / inbox
- pay-per-view unlockable messages, tipping, "unlock this post for $X"
- live streaming, stories / ephemeral posts
- native mobile apps
- creator-to-creator collaboration posts

Also deferred: **Spaces** has been extracted from WEB PHASE 11 to its own
experimental prompt, [`prompts/atproto-spaces.md`](../prompts/atproto-spaces.md),
which runs dead last and still has no user-facing UI surface — the client never
knows which `ContentRepository` served a post. Transactional email /
notifications (receipts, moderation notices) remain out of scope platform-wide.

Also planned (post-WEB PHASE 10, before WEB PHASE 12): the web halves of
[`prompts/creator-owned-pds.md`](../prompts/creator-owned-pds.md) and
[`prompts/bluesky-public-posts.md`](../prompts/bluesky-public-posts.md) — a
creator portability/status panel (DID, handle, PDS URL, record collections,
last sync; "no export needed to move to a compatible service"), composer copy
that distinguishes Bluesky-compatible public posts from encrypted gated posts
(and validates Bluesky text/facet/media limits), feed cards that merge a
dual-published post's two AT records into one, and a single-post view that
resolves by local id, `fans.foryour.post` URI, or `app.bsky.feed.post` URI.
Cross-cutting requirement #4 extends: decryption keys for content the viewer
can't access never reach the client. See `docs/build-plan.md` →
"Planned rearchitecture".

## Known limitations after WEB PHASE 9

- **`/feed` has no cursor.** `GET /feed` is limit-only by backend design (see
  `apps/api/src/routes/feed.ts`'s doc comment) — "Load more" re-fetches at
  `limit+20` rather than paginating from a cursor, unlike `/c/[handle]`'s
  Posts tab. A strictly cursor-based home feed is a backend Phase 9 change,
  out of scope for a web-only phase.
- **Prev/next post navigation degrades silently past 50 posts.** There is no
  "get this post's neighbors" route; `findFeedNeighbors` locates the post
  within one `limit=50` page of `GET /creators/:id/feed`. A creator's post
  older than their most recent 50 just shows no Newer/Older links — an
  accepted degradation over an unbounded cursor walk, not a bug.
- **"Subscribed" is inferred, not API-reported.** `postBadges()` shows it on
  any unlocked `SUBSCRIBERS`/`TIER` post where the caller isn't the owner —
  correct given the API's current shapes (an unlocked gated post always means
  either "you're the owner" or "you're entitled"), but there's no explicit
  `viewerIsSubscribed` field to assert against if that assumption ever stops
  holding (e.g. a future "creator subscribes to themselves" case).
- **The single-post view (`PostArticle`) doesn't show "Subscribed."** Only
  feed/list cards (`PostCard`) do — `PostArticle` still uses
  `POST_VISIBILITY_META`'s per-visibility badge, unchanged from WEB PHASE 7.
  The spec's "distinct card states" bullet is about feed cards specifically.

## Known limitations after WEB PHASE 8

- **Media bytes still live in app object storage, not the creator's PDS.**
  WEB PHASE 8 wires the full upload/attach/render path against `packages/media`'s
  S3-compatible storage; publishing `fans.foryour.media` blobs to the creator's
  own PDS is a `creator-owned-pds.md` implementation-phase item.
- **NSFW is a mechanism, not a policy.** `MediaGallery`/`MediaThumb`/lightbox
  blur-by-default and offer a per-item reveal, but nothing sets `nsfw` — there
  is no content-label API before WEB PHASE 14, so it defaults off everywhere.
- **A rejected attachment can't be retried in place.** The uploader no longer
  holds the original `File` once a row errors, so "retry" removes the row and
  asks the user to re-add it.
- **No client-side image transcode/resize.** Whatever the creator picks is what
  gets uploaded and served (`PassthroughMediaProcessor`); the size caps
  (25 MB image / 500 MB video) are the only guardrail until real processing
  (WEB PHASE 14) lands on the same `MediaProcessor` hook.

## Known limitations after WEB PHASE 7

- **No draft state.** The `Post` model has no draft/published field, so the
  composer publishes on save (button reads "Publish" / "Save changes"). A real
  draft lifecycle would touch entitlement filtering across Phases 7 and 9 and
  is deferred — a documented placeholder, like avatar upload (WEB PHASE 8).
- **Body is plain text.** `prompts/web.md` left "plain text or minimal
  markdown" to be decided here; plain text was chosen — line breaks are kept,
  nothing is interpreted as HTML/markdown. A richer editor can layer on later
  without a storage change.
- **The `/c/[handle]` Posts section was still an `EmptyState`** at the time
  WEB PHASE 7 shipped (the per-creator post feed, `CreatorFeed`, landed early
  as part of `bluesky-public-posts.md`'s web half — see WEB PHASE 9 above).
- **`GET /creators/:identifier/posts` silently omits inaccessible posts** (no
  locked stubs) — the creator's own `/creator/posts` list is unaffected
  (owner sees everything). The locked-stub variant is `GET /creators/:id/feed`
  (used by `CreatorFeed`, the `/c/[handle]` Posts tab).

## Known limitations after WEB PHASE 5

- **Tiers created active only.** `POST /creators/me/tiers` has no `isActive` in
  its body, so a new tier is always active; the row `Switch` deactivates it
  afterward. No "save as inactive" in the create dialog.
- **Reorder is N× `PATCH`.** There's no bulk-reorder route, so a drag issues
  one `PATCH /creators/me/tiers/:id` per row whose `sortOrder` changed, and
  each re-publishes that tier's `fans.foryour.tier` record. A failed batch
  reverts the list optimistically.
- **Deactivated tiers are read-only in the UI** — reactivate or leave them;
  there's no edit affordance, which avoids `PATCH` re-publishing an AT record
  that `DELETE` just retracted.
- **The tier currency picker is `usd`/`eur`/`gbp`.** The API accepts any
  lowercase ISO-4217 code; `lib/tier.ts` just offers a short list.
- `Subscribe` on tier cards (`/c/[handle]`) is a disabled placeholder until
  WEB PHASE 6.

### Carried over from WEB PHASE 4

- **No API change in WEB PHASE 4.** Two spec items can't be built against the
  shipped Phase 4 API and are marked placeholders (per web.md #5 / #10):
  - **Avatar & banner upload** — there is no public AT blob-upload path
    (`com.atproto.repo.uploadBlob` to the creator's PDS; `packages/atproto`
    only writes records, and creator image URL overrides are local-only).
    This is a *different* mechanism from WEB PHASE 8's private post media —
    still unbuilt, a `creator-owned-pds.md` item. Creator settings shows
    Bluesky fallback status and no upload controls.
  - **Content-rating persistence** — `Creator` / `fans.foryour.profile` have no
    adult / content-rating field, so the wizard's 18+ self-attestation +
    adult toggle are collected but **not saved**. A real flag + KYC/age
    verification is WEB PHASE 14. Consequently `/c/[handle]` has no data-driven
    adult age gate yet.
- **The creator page address follows the AT handle** (`/c/<handle>`, or
  `/c/<did>` which never breaks). There is no app-owned slug — the
  Handle-as-Identity refactor removed it, along with `apps/web/lib/slug.ts`
  and the slug-change dialog. A changed handle's old `/c/<oldhandle>` link
  `308`-redirects to the current one (`GET /creators/:identifier` answers a
  former handle with `301 {movedTo}`; the page issues `permanentRedirect`).
  The redirect only updates after the creator next signs in (login-time
  handle sync) — real-time tracking is a later phase.
- Nav/footer links to still-unbuilt routes (`/creator/dashboard`) 404 until
  their phase.
- `/dashboard`, `/settings`, `/creator/settings`, `/c/[handle]` metadata: server
  fetches `throw` (→ `error.tsx`) if the API is down after the layout OK'd the
  session. Loading/error pass is WEB PHASE 15.
- After "Refresh from AT Protocol" / a creator profile save, server-rendered
  surfaces re-read via `router.refresh()`, but the client `SessionProvider`
  context value isn't updated.
- The Phase 2 API collapses every `POST /auth/atproto/start` failure
  (unresolvable handle, PDS unreachable, OAuth start failure) into one generic
  `400`. `/login` catches malformed handles client-side with a distinct
  message; the other three share one actionable message — the API doesn't
  distinguish them.
- `sessionStorage` carries the post-login `next` across the OAuth round trip.
  In private-mode / storage-blocked browsers it's silently dropped and sign-in
  lands on `/dashboard`.
- Legal pages remain placeholder copy with a "pending legal review" note.
- `/dev/components` is removed from production via a runtime `notFound()`, not
  excluded from the build graph.

## Testing

- **Component (Vitest + RTL):** primitives (`cn`, `Button`, `Avatar`,
  `EmptyState`, `ErrorState`, `CopyButton`), marketing (`Hero`,
  `PersonalizedPanel`, `FeaturedCreators`, `LegalPage`), auth
  (`isSafeInternalPath`/`safeNextOr`, `LoginForm`), settings (`AppearanceTab`,
  `AccountTab`), creator (`OnboardingWizard` 3-step flow + profile-only
  `POST` + server-error surfacing), and tiers (`lib/tier` schema-parity +
  money helpers, `TierCard`, `TierManager` — `reorder()` pure fn, create flow,
  deactivate confirm copy, price-grandfathering callout). The slug unit tests
  were removed with the slug code.
- **E2E (Playwright, `apps/web/e2e/`):** auth round trip + cancelled-auth +
  already-signed-in redirect; `/settings` DID + live theme + disabled switches
  + anon gating; **become-a-creator wizard → `/c/<handle>` as owner**, creator
  settings profile save + the static page-address note, **tier management**
  (create a tier → assert its public card + disabled Subscribe → edit price →
  assert the grandfathering callout → deactivate via the confirm dialog →
  assert it's gone from `/c/<handle>`), and a **stale `/c/<oldhandle>` →
  `308` → `/c/<newhandle>`** redirect (simulated via the fake API's
  `POST /__e2e__/simulate-handle-change`). Runs against a
  fake-OAuth API (`apps/api/test/e2e/fakeServer.ts`, which also wipes its
  fixture creator/user/handle-history on boot) + a production web build; needs
  real Postgres + Redis. `pnpm --filter @foryour-fans/web test:e2e`. **CI
  wiring is WEB PHASE 16.**
