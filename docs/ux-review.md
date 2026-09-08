# Web UX Review

`prompts/web.md` **WEB PHASE 17** deliverable. Review phase — **no new features
were added.** It is the web-client counterpart to
[`docs/final-architecture.md`](./final-architecture.md) (`prompts/full.md` PHASE
17).

Companions, authoritative for their own areas:

- [`docs/ux.md`](./ux.md) — the living screen inventory & state matrix, updated every WEB PHASE. This file reviews and classifies it; it does not replace it.
- [`docs/web-accessibility.md`](./web-accessibility.md) — the WEB PHASE 15 accessibility audit.
- [`docs/final-architecture.md`](./final-architecture.md) — the API/system review, including the payment-provider-coupling and portability analysis this file cross-references.

## Method

Every route file under `apps/web/app/**`, every `apps/web/lib/*`, and the
component tree under `apps/web/components/**` were read. `next build` is green;
the production route table (below) confirms per-route code-splitting and
first-load JS sizes. `pnpm --filter @foryour-fans/web lint` (with
`eslint-plugin-jsx-a11y --max-warnings=0`) and `typecheck` are green; the Vitest
component suite and the Playwright e2e suite are green.

**No material UX or security defect was found that WEB PHASE 15's hardening pass
or its follow-up audit had not already found and fixed.** The two spec-compliance
gaps that audit caught (payout onboarding ungated on `verificationStatus`;
missing per-content moderation-notice banners) are both fixed and shipped. The
only change this phase makes is this document.

---

## Screen inventory

Route → purpose → the components/libs it owns. `(m)` = `app/(marketing)/`
group (public shell, no session required), `(a)` = `app/(app)/` group
(anonymous → `/login?next=`), `—` = top-level / no group.

| Route | Grp | Purpose | Owns |
|---|---|---|---|
| `/` | (m) | Landing. Logged-out hero + explainer sections + **Featured creators** strip (first page of `GET /discover`). Logged-in personalized panel in place of the hero, **no redirect**. | `(marketing)/page.tsx`, `components/marketing/{Hero,PersonalizedPanel,FeaturedCreators}` |
| `/about` | (m) | What the platform is + AT Protocol rationale. | `(marketing)/about/page.tsx` |
| `/terms`, `/privacy`, `/legal/compliance` | (m) | Placeholder legal copy, `noindex`, visible "pending legal review" note. | `components/marketing/LegalPage.tsx` |
| `/discover`, `/search` | (m) | Browse / search creators. One client component seeded with a different first page (`GET /discover` unfiltered / `GET /search?q=`). Debounced input, cursor-paginated `CreatorCard` grid, distinct loading/empty/no-results/error states. Unregistered indexed profiles render inert ("Not on foryour.fans yet"). | `components/discover/{DiscoverBrowser,CreatorCard}`, `lib/discover.ts` |
| `/feed` | (m) | Home feed. **anon** → `FeedLoggedOut` explainer, no `/feed` call. **authed** → `GET /feed?limit=20` (PUBLIC platform-wide + actively-subscribed creators, deduped), `PostCard`s, "Load more" re-fetches at `limit+20`. | `(marketing)/feed/*`, `components/post/FeedList` |
| `/login` | (m) | Handle form: shape validation, specific start-error copy, stores safe `next`. **authed → redirect** to `next`/`/dashboard`. | `(marketing)/login/LoginForm.tsx`, `lib/nav.ts` |
| `/auth/callback` | — | "Finishing sign-in…" interstitial. Routes new-vs-returning, honors stored `next`, friendly `?error` copy. No OAuth internals shown. | `app/auth/callback/*` |
| `/c/[handle]` | (m) | Public creator page. Segment is an AT handle or URL-encoded DID. Avatar/banner (site override → Bluesky fallback → initials), bio, tier cards (`GET /creators/:id/tiers`, **18+** badge), per-tier `Subscribe` (anon → login; adult tier → `AgeGateDialog` → review `Dialog` → `POST …/subscribe`), a **Posts** tab (`CreatorFeed`, cursor-paginated, locked stubs rendered as locked `PostCard`s). Owner sees Edit / Manage tiers; signed-in non-owner sees `CreatorActionsMenu` (Report / Block). `301 {movedTo}` → `permanentRedirect`; `404` → friendly "not available". | `(marketing)/c/[handle]/page.tsx`, `components/creator/{TierCard,SubscribeButton,CreatorActionsMenu,CreatorFeed}` |
| `/c/[handle]/post/[id]` | (m) | Single post permalink. `GET /posts/:id`. Entitled/creator/PUBLIC → `PostArticle` (badge, whitespace-preserved text, `MediaGallery` + `MediaLightbox`, Bluesky permalink chip if dual-published, `LikeButton`, `CommentThread`). Everyone else → `LockedPostCard` built only from the `200` locked stub. `ContentLabelGate` (collapse/reveal; non-dismissible for `takedown`), `AdultContentGate` (client `confirmAge()`). Newer/Older `PostNav`. Non-owner → `PostActionsMenu` + per-comment `CommentActionsMenu`. `noindex` for non-PUBLIC/locked. | `components/creator/{PostArticle,LockedPostCard}`, `components/post/{PostNav,LikeButton,CommentThread,CommentComposer}`, `components/moderation/*`, `lib/{likes,comments,contentLabels,ageVerification}.ts` |
| `/settings` | (a) | Tabs Account / Appearance / Notifications / **Blocks** (`?tab=` deep-links). Account: AT-vs-app field provenance, copyable immutable DID, "Refresh from AT Protocol" (`POST /me/refresh`), inert deactivation card. Appearance: theme → `ff_theme` cookie, live. Notifications: disabled preview. Blocks: `GET /blocks` list, per-row Unblock (`DELETE /blocks/:did`). | `app/(app)/settings/*`, `components/*/{AccountTab,AppearanceTab,BlocksTab}`, `lib/{blocks,theme}.ts` |
| `/dashboard` | (a) | Generic account landing (distinct from `/creator/dashboard`). Profile card, `?welcome=1` nudge, logout, creator links. **Still pre-design-system** (only route not restyled). | `app/(app)/dashboard/*` |
| `/become-a-creator` | (a) | 3-step wizard: Profile → Content rating (self-attest 18+) → Review → `POST /creators` (profile fields only). Checked adult toggle redirects to `/creator/verification`. | `app/(app)/become-a-creator/*`, `components/creator/OnboardingWizard` |
| `/creator/settings` | (a) | Profile edit (`PATCH /creators/me`), avatar/banner card (Bluesky fallback status, **pending upload controls**), links to tiers / payouts / verification, static "Page address follows your AT handle" note (no slug dialog). | `app/(app)/creator/settings/*` |
| `/creator/verification` | (a) | Creator identity verification. `GET /creators/me` → `verificationStatus` (`UNVERIFIED`/`PENDING`/`VERIFIED`; no `REJECTED` — rejection resets to `UNVERIFIED`). Clearly-labeled placeholder (no document collected) → `POST /creators/me/verification/submit`. This is the **real** admin-reviewed gate `posts.ts`/`tiers.ts` check for `containsAdultContent: true`. | `app/(app)/creator/verification/*`, `lib/verification.ts` |
| `/creator/tiers` | (a) | Tier management. `GET /creators/me/tiers` (active + deactivated). Drag-to-reorder (`@dnd-kit`, keyboard-operable; N× `PATCH`), active/inactive `Switch` (off → deactivate confirm → `DELETE`; on → `POST …/reactivate`), create/edit `Dialog` (price major→minor, currency, **adult** checkbox only when `VERIFIED`), grandfathering callout. | `app/(app)/creator/tiers/*`, `components/creator/{TierManager,TierCard}`, `lib/tier.ts` |
| `/creator/posts` | (a) | The creator's own posts (all visibilities, newest first). Per row: visibility badge, relative time, preview, Edit, Delete-with-confirm (optimistic). | `app/(app)/creator/posts/*`, `lib/post.ts` |
| `/creator/posts/new`, `/creator/posts/[id]/edit` | (a) | `PostComposer`. Plain-text body + char counter, visibility selector (`Public`/`Subscribers`/`Specific tier` + tier `Select`), **persistent non-dismissible PUBLIC warning**, **adult** checkbox only when `VERIFIED` (omit-not-`false` semantics), `MediaUploader` (client MIME/size check → presigned `PUT` w/ progress → `processing`→`ready`/`rejected`; `@dnd-kit` reorder → `sortOrder`; **Publish disabled until every attachment `ready`**). `502` → "saved, but publishing to the AT network failed". | `components/creator/PostComposer`, `components/media/{MediaUploader,...}`, `lib/media.ts` |
| `/subscriptions` | (a) | The viewer's own subscriptions (`GET /subscriptions`). Per row: creator link, tier name, **snapshot** price, status badge, timing line. `active`/`past_due`/`pending` → optimistic **Cancel at renewal** `Switch` (`PATCH /subscriptions/:id`). `canceled`/`expired` → **Resubscribe** → `/c/<addr>`. `past_due` banner; "update payment method" is a **disabled placeholder**. | `app/(app)/subscriptions/*`, `components/*/SubscriptionList`, `lib/subscriptions.ts` |
| `/subscribe/return` | (a) | Post-hosted-checkout landing. Client-only: reads a `sessionStorage` context, **polls `GET /subscriptions`** (≤6×, 1.5 s) to reconcile — `ACTIVE`→success, still `PENDING`→"processing" + manual retry, else "didn't go through, you weren't charged". No synchronous "subscribed". `noindex`, `force-dynamic`. | `app/(app)/subscribe/return/*` |
| `/subscribe/cancel` | (a) | Static "checkout cancelled — nothing charged" + links. `noindex`. | `app/(app)/subscribe/cancel/page.tsx` |
| `/creator/payouts` | (a) | Payout onboarding. `GET /creators/me/payout-account/status` → `NOT_STARTED`/`PENDING`/`VERIFIED`/`RESTRICTED`. **Starting requires `Creator.verificationStatus === "VERIFIED"`** (WEB PHASE 15 audit fix) — otherwise a pointer to `/creator/verification`. Verified + `NOT_STARTED`/`RESTRICTED` → self-declared 18+ checkbox → `POST …/payout-account` → external redirect. `PENDING` → manual + on-focus re-poll (no payout webhook). With the fake provider only `NOT_STARTED`/`PENDING` are reachable. | `app/(app)/creator/payouts/*` |
| `/creator/dashboard` | (a) | `GET /creators/me/dashboard` (`?from=&to=`). Four always-visible stat tiles (Subscribers, Active, New, Cancellations). Revenue card + MRR chart wrapped in `PayoutGate` (replaced by a prompt until payout `VERIFIED`). `recharts` area charts (one series, no legend). `DateRangeFilter` (7/30/90 presets + custom `<input type=date>`), client re-fetch. Recent posts (last 5). `NewCreatorGuidance` checklist for a brand-new creator. | `app/(app)/creator/dashboard/*`, `components/dashboard/*`, `lib/dashboard.ts` |
| `/admin`, `/admin/cases`, `/admin/cases/[id]`, `/admin/audit-log` | (a) | Role-gated moderation console. `(app)/admin/layout.tsx` → `notFound()` for a non-admin (**plain 404, never a confirming 403**; the API's `requireAdmin` is the real boundary). Case queue (filters mirror query params), case detail (linked reports, `ContentLabel` apply/remove, `classifierSuggestion` rendered as an advisory signal, per-`subjectType` action buttons — every reason-requiring action needs a reason; buttons vanish once the case leaves `OPEN`), read-only audit log. | `app/(app)/admin/*`, `components/moderation/*`, `lib/admin.ts` |
| `/healthz` | — | Route Handler (not a page — never touches session/theme). Liveness/readiness probe. | `app/healthz/route.ts` |
| `/dev/components` | — | Every `components/ui` primitive in both themes. `notFound()` in a production build. | `app/dev/components/*` |
| `/sitemap.xml`, `/robots.txt`, `/opengraph-image` | — | SEO. Sitemap: `/`, `/about`, `/discover`. Robots disallows app/auth/api/dev. OG image: **text-only, brand-controlled, never user or NSFW imagery**. | `app/{sitemap,robots}.ts`, `app/opengraph-image.tsx` |
| `*`, render error | — | `not-found.tsx` (`EmptyState` + home link); `error.tsx` (`ErrorState` + `reset()`); per-segment `error.tsx` on every route that fetches. | `app/{not-found,error}.tsx`, `components/shell/{RouteError,RouteLoading}` |

**Shell contract** (`components/shell/Header.tsx`): the session is resolved on
the server (`lib/session.ts#getSession`, `cache()`-deduped) and passed to
`Header` as a prop, so the correct logged-in/out variant is in the first HTML —
**no logged-out→logged-in flash.** `AccountStatusBanner` (account-level
restrict/suspend) and `ModerationNoticesBanner` (per-content removal, via
`GET /me/moderation-notices`) sit in the `(app)` layout.

---

## State matrix

Personas: **anon** (no session) · **authed** (session, no creator) · **creator**
(owns the creator area being viewed) · **sub** (subscribed to the creator being
viewed) · **admin** (`User.role === "ADMIN"`).
Cells: ✅ implemented · 🚧 stubbed/placeholder · ⛔ intentionally blocked
(redirect/404) · — n/a.

| Route | anon | authed | creator | sub | admin | Impl. status |
|---|---|---|---|---|---|---|
| `/` | ✅ hero | ✅ panel | ✅ panel + dashboard link | ✅ panel | ✅ panel | complete |
| `/about`, `/terms`, `/privacy`, `/legal/compliance` | ✅ | ✅ | ✅ | ✅ | ✅ | legal copy is 🚧 placeholder (labeled) |
| `/discover`, `/search` | ✅ | ✅ | ✅ | ✅ | ✅ | complete; **no NSFW/age gate** (no content-rating field to gate on) |
| `/feed` | ✅ explainer | ✅ stream | ✅ | ✅ | ✅ | complete; limit-only pagination (backend design) |
| `/login` | ✅ | ⛔ → `next`/`/dashboard` | ⛔ | — | ⛔ | complete |
| `/auth/callback` | ✅ error copy | ✅ | ✅ | ✅ | ✅ | complete |
| `/c/[handle]` | ✅ (Subscribe → login) | ✅ | ✅ own page: Edit + Manage tiers | ✅ (409 → `/subscriptions`) | ✅ | complete |
| `/c/[handle]/post/[id]` | ✅ locked treatment | ✅ | ✅ own post: full | ✅ entitled: full | ✅ | complete |
| `/settings` | ⛔ → `/login?next=` | ✅ | ✅ | ✅ | ✅ | complete |
| `/dashboard` | ⛔ → `/login?next=` | ✅ | ✅ + creator links | — | ✅ | **pre-design-system** (only unstyled route) |
| `/become-a-creator` | ⛔ → `/login?next=` | ✅ | ⛔ → `/c/<handle>` (or `/creator/verification`) | ✅ | ✅ | complete; content-rating is **collected, not persisted** (no field) |
| `/creator/settings` | ⛔ → `/login?next=` | ⛔ → `/become-a-creator` | ✅ | — | — | complete; avatar/banner upload = 🚧 (no AT blob path) |
| `/creator/verification` | ⛔ → `/login?next=` | ⛔ → `/become-a-creator` | ✅ | — | — | workflow real; body is 🚧 (no document collected) |
| `/creator/tiers` | ⛔ → `/login?next=` | ⛔ → `/become-a-creator` | ✅ | — | — | complete |
| `/creator/posts`, `/creator/posts/new`, `/creator/posts/[id]/edit` | ⛔ → `/login?next=` | ⛔ → `/become-a-creator` | ✅ | — | — | complete; no draft state (no `Post` field); body plain-text by choice |
| `/subscriptions` | ⛔ → `/login?next=` | ✅ (empty) | ✅ | ✅ | ✅ | complete; "update payment method" = 🚧 (no provider portal route) |
| `/subscribe/return`, `/subscribe/cancel` | ⛔ → `/login?next=` | ✅ | ✅ | ✅ | ✅ | complete |
| `/creator/payouts` | ⛔ → `/login?next=` | ⛔ → `/become-a-creator` | ✅ | — | — | complete; only `NOT_STARTED`/`PENDING` reachable with the fake provider |
| `/creator/dashboard` | ⛔ → `/login?next=` | ⛔ → `/become-a-creator` | ✅ | — | — | complete; time-series is an approximation (backend); currency best-effort |
| `/admin/*` | 404 | 404 | 404 | 404 | ✅ | complete; **no queue for pending verifications** (no list endpoint); charts N/A |
| `/dev/components` | 🚧 | 🚧 | 🚧 | 🚧 | 🚧 | dev-only, `notFound()` in prod builds |

Nothing in the matrix is **missing** — every cell is implemented, an
intentional block, or a labeled placeholder tied to an absent backend field or
an unmade business decision. The one route that is genuinely behind is
`/dashboard` (pre-design-system, explicitly "not yet scheduled" — it is the
generic account page, distinct from the shipped `/creator/dashboard`).

---

## Flow diagrams

### Flow 1 — login → session

```
/login  (LoginForm)
  │  handle shape-validated client-side
  │  POST /api/auth/atproto/start  (same-origin proxy → API)
  │  safe `next` stashed in sessionStorage (ff.postLoginNext)
  ▼
API → authorization server (user's own PDS)  — PKCE + DPoP + PAR
  ▼  user consents
GET /api/auth/atproto/callback  (API: token exchange, upsert User,
  │  adminBootstrap, CreatorHandleHistory, mint session)
  │  Set-Cookie: ff_session (HttpOnly, Secure prod, SameSite=Lax) + ff_csrf
  │  302 → <PUBLIC_URL>/auth/callback  (± ?error=<code>)
  ▼
/auth/callback  (client)
  ├─ error=access_denied         → "Sign-in cancelled" + back-to-login
  ├─ error=<other>               → "Sign-in didn't finish" + retry
  ├─ sessionStorage `next` (safe) → window.location.replace(next)
  ├─ GET /api/creators/me → 404  → /dashboard?welcome=1
  └─ otherwise                   → /dashboard
  ▼
every later render:
  Server Components → lib/session.ts#getSession() (cache()-deduped, one /me call)
    → Header gets the right variant in the FIRST HTML (no flash)
  (app)/layout.tsx: getSession() !== "authenticated" → redirect(/login?next=<x-pathname>)
  client mutations → lib/apiFetch.ts: 401 → emitSessionCleared() + toast +
    redirect(/login?next=<current>)
```

`next` open-redirect guard: `lib/nav.ts#isSafeInternalPath` — same-site paths
only, never `//…`, `/api…`, `/auth/…`. Applied on both the "already signed in"
redirect and callback routing.

### Flow 2 — subscribe → hosted checkout → unlock

```
/c/[handle]  (SubscribeButton, per tier)
  ├─ anon                         → /login?next=/c/<addr>
  ├─ adult tier & no confirmAge() → AgeGateDialog (client-only localStorage attestation)
  └─ review Dialog: locked-in price + grandfather note
        │  POST /api/creators/:identifier/subscribe  { tierId }
        │  (409 "already subscribed" → link to /subscriptions)
        ▼
API: Subscription row PENDING, priceCentsAtSubscription SNAPSHOT
     returns { redirectUrl }   ← hosted-checkout model, NEVER synchronous "active"
        ▼
browser: stash { address, creatorName, subscriptionId } in sessionStorage
         window.location = redirectUrl  → provider hosted checkout page
        │
        ├─ user completes → provider redirects → /subscribe/return
        └─ user backs out → provider redirects → /subscribe/cancel (static)
        ▼
/subscribe/return  (client, force-dynamic, noindex)
  polls GET /api/subscriptions  ≤6× every 1.5s:
    ACTIVE                → success: link to unlocked creator + /subscriptions
    still PENDING after 6 → "payment processing" + manual "Check again"
    PAST_DUE/CANCELED/gone→ "didn't go through — you weren't charged"
    fetch error          → error + retry
        ▼   (meanwhile, out of band)
POST /api/webhooks/:provider → Subscription → ACTIVE → canAccess → content unlocks
```

The UI never assumes a synchronous subscription — it matches the fake provider
and any real hosted-checkout processor identically.

### Flow 3 — compose → upload → publish (public vs private)

```
/creator/posts/new | /creator/posts/[id]/edit  (PostComposer)
  │  body: plain text + grapheme/char counter
  │  visibility: Public | Subscribers | Specific tier (→ tier Select)
  │  ── if Public:  PERSISTENT non-dismissible warning (mandated copy) +
  │                 Bluesky-limit live validation (300 graphemes / 3000 bytes / tags)
  │  ── if gated:   "encrypted, not on Bluesky" copy
  │  adult checkbox: shown ONLY if verificationStatus === VERIFIED;
  │                  omitted-not-false so an unverified edit never clears an existing true
  │
  ├─ MediaUploader (per file):
  │     client MIME + size check  →  POST /api/media/upload-url (MediaAsset PENDING_UPLOAD)
  │     →  PUT bytes straight to object storage (real progress bar)
  │     →  POST /api/media/:id/complete  →  poll GET /api/media/:id  (PROCESSING → READY | REJECTED)
  │     →  @dnd-kit reorder → sortOrder
  │     PUBLISH BUTTON DISABLED until every attachment is READY
  ▼
POST | PATCH /api/creators/me/posts[/:id]   { visibility, text, minimumTierId?, media:[{id,sortOrder}] }
  │  API: resolvePostMedia validates every id (READY, owned, ≤ MAX_POST_MEDIA) BEFORE any AT write
  ▼
  ├─ visibility PUBLIC  → PrivateContentRepository publishes fans.foryour.post
  │                       (+ app.bsky.feed.post first, if CREATOR_OWNED_PDS_ENABLED)
  │                       to the CREATOR'S OWN PDS, then Postgres row
  │     502 → toast "saved, but publishing to the AT network failed"
  └─ visibility SUBSCRIBERS/TIER → Postgres-only, NO AT record, ever
  ▼
toast → /creator/posts  → appears on /c/[handle] Posts tab + (if PUBLIC) /feed + discovery index
```

Media *bytes* live in app object storage, never a PDS (a `creator-owned-pds.md`
deferral). The composer is text + app-media only.

### Flow 4 — report → moderation case

```
Any surface (creator page / post permalink / a comment)
  │  CreatorActionsMenu | PostActionsMenu | CommentActionsMenu  → ReportDialog
  │  reason picker (SPAM/HARASSMENT/IMPERSONATION/SEXUAL_CONTENT_VIOLATION/
  │                 NCII/COPYRIGHT/ILLEGAL_CONTENT/OTHER) + free text
  │  POST /api/reports  { subjectType, subjectId, reason, detail }
  │  requireSession + requireNotRestricted
  ▼
API packages/moderation#createReport
  │  validates the subject exists & isn't deleted
  │  findOrOpenCase → attaches to the ONE open ModerationCase for that subject
  │  requiresLegalReview auto-set if reason ∈ {NCII, ILLEGAL_CONTENT}
  │  ContentClassifier.suggestForReport (PassthroughContentClassifier → null today)
  ▼
UI: always the same "thanks for the report" confirmation — NO case status,
    NO "already reported" signal  (matches POST /reports' "no case internals" contract)

Admin side  (/admin, role-gated; non-admin → 404):
  /admin/cases         GET /admin/cases[?status=][&requiresLegalReview=]  — queue
  /admin/cases/:id     GET /admin/cases/:id  — reports, labels, classifier signal, audit trail
     actions by subjectType:
       POST/COMMENT → POST /admin/{posts,comments}/:id/remove   (soft-delete: deletedAt)
       USER         → POST /admin/users/:id/{restrict,reinstate}
       CREATOR      → POST /admin/creators/:id/{suspend,reinstate}
       any          → POST /admin/cases/:id/dismiss, .../labels (apply/remove ContentLabel)
     every reason-requiring action needs a non-empty reason in the UI;
     every action writes an AuditLog row (actorRole snapshotted)
  ▼
Removed content the reporter/owner can see:
  GET /me/moderation-notices  (distinguishes a moderator removal from a self-delete
  via AuditLog CONTENT_REMOVED entries) → ModerationNoticesBanner + disabled "Appeal" placeholder
```

---

## Risk list

✅ mitigated · ⚠️ accepted / documented trade-off · 🔲 open before a real
launch.

### Accessibility

| # | Item | Status |
|---|---|---|
| A1 | WCAG AA contrast across design tokens + Badge's composited tint pairing | ✅ tuned in WEB PHASE 15; `@axe-core/playwright` (`e2e/zz-accessibility.spec.ts`) guards regressions on the named flows |
| A2 | Static structural a11y (labels, ARIA, roles, `tabindex`, keyboard-vs-click) | ✅ `eslint-plugin-jsx-a11y` `recommended`, `--max-warnings=0`; 3 documented suppressions (`PostComposer` autofocus on a dedicated compose page; `Card` heading; `MediaLightbox` `<video>` with no caption pipeline) |
| A3 | Focus management on route change + in dialogs/menus | ✅ `RouteFocusManager` + Radix primitives; verified by axe against real rendered dialogs |
| A4 | `prefers-reduced-motion` | ✅ blanket `globals.css` override + `motion-reduce:` on `Spinner`/`Skeleton` |
| A5 | **No live screen-reader pass** (VoiceOver/NVDA/JAWS) of the core flows | 🔲 environment has none; the three static layers check the same underlying facts but not reading-order-out-loud |
| A6 | axe scans cover only the phase's named flows (login/subscribe/locked post/comment); `/admin/*`, `/creator/dashboard`, `/discover` are lint + component-test only | ⚠️ extending `zz-accessibility.spec.ts` per-route is cheap incremental work |
| A7 | `MediaLightbox` video has no captions/`<track>` | ⚠️ no captioning pipeline for creator video exists — a documented platform gap, not faked |
| A8 | `recharts` charts render 0×0 under jsdom; component tests are smoke-level (role/aria only) | ⚠️ real rendering covered by `e2e/dashboard.spec.ts` (real browser) |
| A9 | Radix `DropdownMenu` interactions are slow/unopenable under jsdom | ⚠️ specific tests carry a 45–90 s timeout + `fireEvent` workaround; documented, not a product issue |
| A10 | Lighthouse not run (no headless Chrome + Lighthouse in this environment) | 🔲 route table verified instead (per-route split, ~150–190 kB first-load, `/creator/dashboard` 272 kB from `recharts` — isolated; no server-only pkg leak) |

### Client could over-fetch / leak protected data

| # | Item | Status |
|---|---|---|
| O1 | Locked post body/media never reaches the client | ✅ `LockedPostCard` is built **only** from the API's `200` locked stub (`id`, creator, `createdAt`, `visibility`, `requiredTier`, `hasMedia`) — no `text`/`media` field is present in the response; `LikeButton`/`CommentThread` are never rendered by `LockedPostCard` (unit + e2e assert this) |
| O2 | Signed media bytes for a locked post | ✅ `GET /media/:id/access` 403s the bytes independently of the stub (e2e asserts) |
| O3 | Content labels are computed on the single-post view only, not feed/list rows | ⚠️ avoids an N+1 label lookup per feed row; a labeled post is not visibly labeled until opened directly. A batched label endpoint doesn't exist. |
| O4 | **Payout gating is client-side only** (`PayoutGate`). `GET /creators/me/dashboard` always returns real `mrrCents`/`revenueByTier`; a creator with devtools open reads their **own** numbers before payout is `VERIFIED` | ⚠️ deliberate — payout verification gates what a creator *sees about their own earnings*, not a confidentiality boundary against their own account (unlike locked-post body/media). Documented in `docs/architecture.md` Phase 13. |
| O5 | Age gate (`confirmAge()`) is `localStorage`-only, no server record | ⚠️ `full.md` Phase 14 elevates only *creator* KYC to a real backend workflow; a subscriber age-verification field/flow is explicitly future work. It gates adult media + adult-tier subscribe identically; re-appears every cleared-storage/private session. |
| O6 | `/discover`, `/search`, `/feed` (anon), `/`'s Featured strip call unauthenticated `GET /discover`/`/search`/`/feed` with no session check | ✅ intentional — those routes require no auth and return only public/PUBLIC data |

### NSFW-leak surfaces

| # | Item | Status |
|---|---|---|
| N1 | OG / Twitter card image | ✅ `app/opengraph-image.tsx` is text-only, brand-controlled — no user or media imagery on any route; verified in the WEB PHASE 15 metadata pass |
| N2 | Logged-out / crawlable surfaces | ✅ non-PUBLIC and locked post pages are `noindex`; `robots.txt` disallows app/auth/api/dev; sitemap lists only `/`, `/about`, `/discover` |
| N3 | Feed/discovery cards | ✅ carry no media body for gated posts (locked stub); `PUBLIC`-post media thumbs blur-by-default (`MediaThumb`) with a per-item reveal |
| N4 | Adult content on a creator page before age confirmation | ✅ `AdultContentGate` wraps body + media on the permalink; **18+** badge on adult tiers |
| N5 | `/discover` and `/search` have **no** NSFW/age gate on adult creators | ⚠️ there is no content-rating field in the schema to gate on — `/become-a-creator`'s "content rating" step has been a labeled placeholder since WEB PHASE 4 and was never given a backing field. Deferred, not an oversight. |
| N6 | `img-src https:` / `media-src https:` in the CSP (not a fixed allowlist) | ⚠️ unavoidable — avatars live on the creator's own PDS (arbitrary domain) and gated media on whatever bucket production uses (signed URLs, not a stable domain). `script-src` does **not** carry the relaxation. |

### Payment-provider coupling in the UI

| # | Item | Status |
|---|---|---|
| PP1 | Subscribe flow assumes a hosted-checkout `redirectUrl` and reconciles via polling `GET /subscriptions` | ✅ no synchronous-subscription path anywhere; matches the fake and any real hosted-checkout processor. `/subscribe/return` + `/subscribe/cancel` are the provider's return/cancel targets. |
| PP2 | "Update payment method" (past-due) button | 🚧 disabled placeholder — the provider payment-portal route isn't in the Phase 6 API and no real provider is chosen |
| PP3 | Payout onboarding | ✅ `window.location.assign(onboardingUrl)` to whatever the provider returns; status re-polled on focus (no payout webhook). `VERIFIED`/`RESTRICTED` states unreachable with the fake provider — labeled as such. |
| PP4 | No processor SDK, iframe, or hosted-field embed anywhere in the client bundle | ✅ the browser only ever redirects to the provider; nothing processor-specific is imported |
| PP5 | Currency rendering | ⚠️ `lib/tier.ts` offers `usd`/`eur`/`gbp` in the picker (API accepts any ISO-4217); dashboard shows one best-effort modal currency symbol over a summed total for a genuinely multi-currency creator |

### Handle-vs-DID assumptions

| # | Item | Status |
|---|---|---|
| H1 | Every creator link resolves by a DID-stable identifier | ✅ `/c/<did>` never breaks; `/c/<handle>` for a former handle → API `301 {movedTo}` → `permanentRedirect('/c/<movedTo>')` |
| H2 | The redirect only updates after the creator's next login (login-time handle sync) | ⚠️ real-time cross-session handle tracking is a later phase; a just-changed handle 404s until the creator signs in again |
| H3 | `/c/[handle]/post/[id]` with a segment that is neither the creator's handle nor DID | ✅ redirects to the canonical address |
| H4 | De-indexed / unregistered creator on `/discover` | ✅ card renders inert ("Not on foryour.fans yet"), never links to a 404 (`isRegisteredCreator`) |
| H5 | No app-owned slug/username exists anywhere | ✅ the Handle-as-Identity refactor removed `lib/slug.ts`, the slug step, and the slug-change dialog; verified by absence |

### SSR / session-flicker risks

| # | Item | Status |
|---|---|---|
| F1 | Logged-out → logged-in header flash | ✅ session resolved on the server (`getSession()`, `cache()`-deduped), passed to `Header` as a prop → correct variant in the first HTML |
| F2 | Theme (light/dark) flash | ✅ SSR stamps `class="dark"` for an explicit choice; `ThemeScript` (inline, nonce'd, pre-paint) covers the `system` case |
| F3 | `loading.tsx` breaking a conditional redirect's HTTP status | ✅ WEB PHASE 15 removed `loading.tsx` from every route whose Server Component can `redirect()`/`notFound()` — a `loading.tsx` in that chain turns a real `30x`/`404` into a `200` + client patch; `e2e/creator.spec.ts` asserts `raw.status()` on the stale-handle redirect |
| F4 | Server fetches with no fallback after the `(app)` layout OK'd the session (`/dashboard`, `/settings`, `/creator/settings`, `/c/[handle]` metadata) | ✅ now intended behavior — each throws to its own `error.tsx` (a friendly retry screen), not a raw error |
| F5 | After "Refresh from AT Protocol" / a profile save, the client `SessionProvider` context value isn't updated (only server surfaces re-read via `router.refresh()`) | ⚠️ documented since WEB PHASE 4; low impact — server-rendered surfaces are correct, only a client-context read is stale until navigation |
| F6 | `sessionStorage`-carried `next` dropped in private-mode / storage-blocked browsers | ⚠️ sign-in silently lands on `/dashboard` instead of `next` |
| F7 | TanStack Query is configured (`QueryClientProvider`) but has **zero** consumers | ⚠️ every fetch is plain `fetch`/`apiFetch` in Server Components or event handlers; kept as an established tech choice for future client-query work, not dead code |

---

## MVP-readiness classification

### Ready for MVP

- **App shell & navigation** — server-resolved session, no auth/theme flash, `(marketing)`/`(app)` group split, correct anon→`/login?next=` redirects with an open-redirect guard.
- **Marketing site** — `/`, `/about`, `/discover`, `/search`, SEO (sitemap/robots/OG), all with real data and distinct loading/empty/error states.
- **Auth UX** — validated `/login`, `/auth/callback` new-vs-returning routing, session-expiry handling (`apiFetch` 401 → toast + redirect), no OAuth internals surfaced.
- **`/settings`** — Account (AT-vs-app provenance, copyable DID, refresh), Appearance (live theme), Blocks (real `app.bsky.graph.block` records).
- **Creator onboarding** — 3-step wizard → `POST /creators` (profile only).
- **Public creator page `/c/[handle]`** — handle/DID addressing, handle-change redirect, tier cards, subscribe flow, Posts tab with locked stubs, owner vs non-owner affordances.
- **Post permalink `/c/[handle]/post/[id]`** — `PostArticle` / `LockedPostCard` (stub-only), media gallery + lightbox, like button (optimistic + rollback), comment thread (cursor-paginated), content-label + adult-content gates, prev/next nav, report/block menus.
- **Tier management** — drag-reorder, activate/deactivate, create/edit, grandfathering callout, adult flag gated on `VERIFIED`.
- **Post composer** — plain-text body, visibility selector, persistent PUBLIC warning, media uploader (client validation → presigned PUT → status poll → reorder, Publish gated on all-ready), adult flag gated on `VERIFIED` with omit-not-false semantics.
- **Subscribe / billing / payouts** — hosted-checkout redirect + poll-to-reconcile, `/subscriptions` management (snapshot price, cancel-at-renewal, resubscribe, past-due banner), payout onboarding gated on `VERIFIED`.
- **Creator dashboard** — stat tiles, payout-gated revenue, `recharts` time series, date-range filter, recent posts, new-creator guidance.
- **Trust & safety UX** — report/block dialogs on every surface, `/creator/verification` (real admin-reviewed gate), content-label collapse/reveal, account-status + per-content moderation banners.
- **Admin console** — role-gated (`notFound()` for non-admins), case queue + detail with per-`subjectType` actions requiring a reason, read-only audit log.
- **Hardening** — per-segment `error.tsx`/`loading.tsx` discipline, offline banner, route-change focus, AA contrast + jsx-a11y + axe guards, per-request CSP nonce, `/healthz`, typed `loadWebEnv()`.

### Needs work before MVP (pre-real-money / pre-adult-launch)

- **Real payment/payout processor in the UI** — "update payment method" (past-due) is a disabled placeholder; `VERIFIED`/`RESTRICTED` payout states are unreachable; the subscribe/return copy assumes but has never exercised a real hosted checkout. Blocked on the same processor decision as the backend.
- **Subscriber age verification** — real per-account age/identity verification replacing the `localStorage` `confirmAge()` self-attestation. Legal/compliance decision + vendor.
- **NSFW gating on `/discover` and `/search`** — requires a real content-rating field (the `/become-a-creator` step has been a placeholder since WEB PHASE 4).
- **KYC document collection UI** — `/creator/verification` is a real workflow around a body that collects nothing; a real vendor integration replaces the body, not the callers or the gate.
- **Admin queue for pending creator verifications** — no page can list creators by `verificationStatus` because no list endpoint exists; an admin needs the creator id from another source.
- **A real screen-reader pass** and a **Lighthouse run** against `/`, `/c/:handle`, `/feed`.
- **First real `docker build` + deploy** of the web image (verified by host reproduction + `kustomize build` only).
- **`/dashboard` restyle** — the generic account landing page is the one route still pre-design-system.
- **Transactional-notification UI touchpoints** (receipt history, "your content was removed" email preferences) — out of scope platform-wide today; required before real-money launch.

### Future work

- Extend `@axe-core/playwright` coverage to `/admin/*`, `/creator/dashboard`, `/discover`.
- Content-label display on feed/list rows (needs a batched label endpoint).
- Cursor pagination for `/feed`; prev/next post nav beyond a 50-post window (needs a neighbors endpoint).
- Rich-text / markdown post bodies; a real draft lifecycle.
- Avatar/banner upload (needs the `com.atproto.repo.uploadBlob` path to the creator's PDS).
- In-place retry for a rejected media upload; client-side transcode/resize.
- A custom date-range picker; multi-currency display.
- Wire `SessionProvider` context to update after profile refresh/save without a navigation.
- Actually use TanStack Query for client-side queries, or remove the provider.
- An appeals flow behind the placeholder "Appeal" link.
- Playwright e2e coverage for the moderation console (blocked on the suite's filename-order / fake-API-state constraints).

### Experimental

- **Creator portability / status panel** (DID, handle, PDS URL, record collections, last sync, "no export needed to move") and composer copy distinguishing Bluesky-compatible public posts from encrypted gated posts — the still-unlanded web halves of `creator-owned-pds.md` / `bluesky-public-posts.md`, waiting on the privacy review. (Feed-card merge of a dual-published pair and multi-shape id resolution on the permalink already shipped.)
- **Spaces UI** (`/dev/spaces` diagnostics behind `ATPROTO_SPACES_ENABLED` — a guard name `prompts/atproto-spaces.md` will introduce, not a live env var today) — extracted to `prompts/atproto-spaces.md`, runs dead last, no user-facing surface; the client never knows which `ContentRepository` served a post.
- Out of scope for every web phase (adding one requires a new `full.md` phase first): DMs/inbox, pay-per-view unlocks / tipping, live streaming, stories, native mobile apps, creator-to-creator collab posts.

---

## Bottom line

The web client is a **coherent, accessible, security-conscious MVP surface for
everything the backend supports.** State coverage is complete — every
route × persona cell is implemented, an intentional block, or a labeled
placeholder tied to an absent backend field or an unmade business decision.
Protected data does not leak to the client (locked stubs are stub-only, media
bytes 403 independently, the one client-side gate — payout figures — is a
creator seeing their *own* numbers). Handle-vs-DID is handled correctly
throughout. There is no session or theme flash.

The gap between "usable" and "launchable" is the same one the backend review
names: a real payment processor, subscriber age verification, a KYC vendor, and
transactional notifications — plus a screen-reader pass, a Lighthouse run, the
`/dashboard` restyle, and a first real container deploy. None is an
architectural problem with the client; each is a downstream decision or a
verification step that needs an environment this build did not have.

No feature changes were made in this phase.
