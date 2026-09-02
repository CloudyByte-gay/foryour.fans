# Web UX — Screen Inventory & State Matrix

Living companion to [`prompts/web.md`](../prompts/web.md). Every `WEB PHASE`
updates this file: add rows as routes appear, fill in the state cells as
behavior is implemented, and move items out of "Planned / not yet built" as
they ship.

**Status: WEB PHASE 4 complete.** WEB PHASES 0–3 (design system, app shell,
marketing, auth UX, `/settings`), plus creator onboarding: the multi-step
`/become-a-creator` wizard (slug rules + live availability, profile,
self-attested content-rating placeholder, review → `POST /creators`), the
public `/c/:slug` page (accepts handle/slug/DID, owner Edit affordance,
`EmptyState`s for tiers/posts, disabled Subscribe), and a rebuilt
`/creator/settings` with a guarded slug-change `Dialog`.

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
  its logged-in variant when a session happens to exist.
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
  Auth semantics, cookies and session storage are otherwise unchanged;
  `apps/api` tests updated / added for both.
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
| `/become-a-creator` | app | 4-step wizard: **Slug** (client rules via `lib/slug.ts` + live availability via `GET /creators/:id` 404-check), **Profile** (displayName/bio/website), **Content rating** (self-attest 18+ → adult toggle; *not persisted*, placeholder), **Review** (what goes to AT `dev.creator.profile` vs the app DB) → `POST /creators`. | ⛔ →`/login?next=` | ✅ | ⛔ → `/c/:slug` | ✅ | ✅ | `app/(app)/become-a-creator/*` |
| `/c/[slug]` | marketing | Public page. Gradient banner + initials avatar (no images until media support), displayName, `@slug`, bio, website, "member since". Tiers / posts → `EmptyState`. **Owner** sees an `Edit` link (compares `session.user.did` to the creator's DID); **non-owner** sees a disabled `Subscribe`. Accepts handle / slug / DID (API classifies). Unknown identifier → friendly "not available" state, not a stack trace. | ✅ | ✅ | ✅ (own page: Edit) | ✅ | ✅ | `app/(marketing)/c/[slug]/page.tsx` |
| `/creator/settings` | app | Profile edit (`PATCH /creators/me`, "last saved" from `updatedAt`, "published to your PDS" copy), an avatar/banner placeholder card, and **Change slug** — a guarded `Dialog` spelling out that old links break + the 7-day cooldown (`PATCH /creators/me {slug}`, surfaces the `429`). Ownership by construction (`/creators/me` is always the caller). | ⛔ →`/login?next=` | ⛔ → `/become-a-creator` | ✅ | — | — | `app/(app)/creator/settings/*` |
| `/dev/components` | — | Every `components/ui` primitive in both themes. **Dev only** — `notFound()` in a production build. | 🚧 | 🚧 | 🚧 | 🚧 | 🚧 | `app/dev/components/*` |
| `/sitemap.xml`, `/robots.txt` | — | SEO. Sitemap lists `/`, `/about`, `/discover`; robots disallows the app/auth/api/dev paths | ✅ | ✅ | ✅ | ✅ | ✅ | `app/sitemap.ts`, `app/robots.ts` |
| `/opengraph-image` | — | Default OG/Twitter card — **text only, brand-controlled, never any user or NSFW imagery** (requirement #5) | ✅ | ✅ | ✅ | ✅ | ✅ | `app/opengraph-image.tsx` |
| `*` (unmatched) | — | `not-found.tsx` — `EmptyState` + link home | ✅ | ✅ | ✅ | ✅ | ✅ | `app/not-found.tsx` |
| render error | — | `error.tsx` — `ErrorState` with `reset()` | ✅ | ✅ | ✅ | ✅ | ✅ | `app/error.tsx` |

> The marketing pages render fully for **anon** with no API session. The only
> session-shaped call in the group is the shell's `getSession()` (`/me`, 401 →
> anonymous) — no authenticated endpoints (`/feed`, `/subscriptions`, …) are
> hit. The `Featured creators` strip is a static `EmptyState` (no fetch yet);
> `loading`/`error` states are added when WEB PHASE 10 wires real data.

### Still pre-design-system

| Route | Group | anon | authed | creator | sub | admin | Restyled in |
|-------|-------|------|--------|---------|-----|-------|-------------|
| `/dashboard` | app | ⛔ →`/login?next=` | ✅ (profile card, `?welcome=1` nudge, logout) | ✅ (+ creator links) | — | ✅ | full dash = WEB PHASE 13 |

> Note: `/dashboard`, `/settings`, `/creator/settings` and `/c/:slug`'s
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
| `/feed` | WEB PHASE 9 | header link when authed |
| `/subscriptions` | WEB PHASE 6 | avatar-menu link |
| `/creator/tiers` | WEB PHASE 5 | |
| `/creator/posts`, `/creator/posts/new` | WEB PHASE 7 | "Create" nav link (creator only) |
| `/creator/payouts` | WEB PHASE 6 | age/identity gate (placeholder until 14) |
| `/creator/dashboard` | WEB PHASE 13 | avatar-menu link (creator only) |
| `/creator/verification` | WEB PHASE 14 | KYC status; gates adult posting + payouts |
| `/c/:slug/post/:id` | WEB PHASE 7 → 9/12 | locked treatment for non-entitled viewers |
| `/subscribe/*` (`return`/`success`/`cancel`) | WEB PHASE 6 | hosted-checkout redirect reconciliation |
| `/settings/blocks` | WEB PHASE 14 | |
| `/admin/*` | WEB PHASE 14 | role-gated; non-admins get **404**, not 403 |
| `/healthz` | WEB PHASE 16 | readiness/liveness probe |
| `/dev/spaces` | WEB PHASE 11 | dev-only diagnostics, behind `ATPROTO_SPACES_ENABLED` |

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

Also deferred: **Spaces** (experimental private-content storage backend, WEB
PHASE 11) has no user-facing UI surface — the client never knows which
`ContentRepository` served a post. Transactional email / notifications
(receipts, moderation notices) remain out of scope platform-wide.

## Known limitations after WEB PHASE 4

- **No API change this phase.** Two spec items can't be built against the
  shipped Phase 4 API and are marked placeholders (per web.md #5 / #10):
  - **Avatar & banner upload** — there is no blob-upload path
    (`packages/atproto` only writes records, `POST /creators` /
    `PATCH /creators/me` take no image fields). The wizard's "Images" concern
    is a note; creator settings shows an "avatar & banner not available yet"
    card. This is WEB PHASE 8 (media).
  - **Content-rating persistence** — `Creator` / `dev.creator.profile` have no
    adult / content-rating field, so the wizard's 18+ self-attestation +
    adult toggle are collected but **not saved**. A real flag + KYC/age
    verification is WEB PHASE 14. Consequently `/c/:slug` has no data-driven
    adult age gate yet.
- **Slug rules are duplicated** in `apps/web/lib/slug.ts` (mirror of
  `apps/api/src/services/creators.ts`) rather than shared via
  `packages/shared` — same call as `lib/csrf.ts` (keep ioredis out of the
  bundle). The server re-validates; the client copy is UX only. Keep in sync.
- **A changed slug's old `/c/:oldslug` still 404s** — no slug-history/redirect
  table (a Phase 4 API limitation, README). `/c/:slug` shows a friendly
  "not available" state rather than a stack trace.
- Nav/footer links to still-unbuilt routes (`/feed`, `/subscriptions`,
  `/creator/tiers|posts|payouts|dashboard`) 404 until their phase.
- `/dashboard`, `/settings`, `/creator/settings`, `/c/:slug` metadata: server
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

- **Component (Vitest + RTL, 50 tests):** primitives (`cn`, `Button`,
  `Avatar`, `EmptyState`, `ErrorState`, `CopyButton`), marketing (`Hero`,
  `PersonalizedPanel`, `FeaturedCreators`, `LegalPage`), auth
  (`isSafeInternalPath`/`safeNextOr`, `LoginForm`), settings (`AppearanceTab`,
  `AccountTab`), and creator (`validateSlugShape`/`sanitizeSlugInput`,
  `OnboardingWizard` step gating + `POST` + error→step-1, `SlugChangeDialog`
  warning + `PATCH` + `429`).
- **E2E (Playwright, `apps/web/e2e/`, 7 tests):** auth round trip +
  cancelled-auth + already-signed-in redirect; `/settings` DID + live theme +
  disabled switches + anon gating; **become-a-creator wizard → `/c/:slug` as
  owner**, and creator settings profile save + slug-dialog warning. Runs
  against a fake-OAuth API (`apps/api/test/e2e/fakeServer.ts`, which now also
  wipes its fixture creator/user on boot) + a production web build; needs real
  Postgres + Redis. `pnpm --filter @foryour-fans/web test:e2e`. **CI wiring is
  WEB PHASE 16.**
