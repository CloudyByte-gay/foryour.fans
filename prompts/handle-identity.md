# REFACTOR PHASE — Handle as Identity (remove creator slugs)

Runs **after `full.md` PHASE 7 / `web.md` WEB PHASE 4** and **before PHASE 8 /
WEB PHASE 5**. It is a self-contained refactor of already-shipped work, run as
its own session(s) — backend first, then web — with the same discipline as a
numbered phase (tests green, exit checklist, `Stop after` line).

Companion files: [`prompts/full.md`](./full.md) (backend), [`prompts/web.md`](./web.md)
(frontend), [`docs/build-plan.md`](../docs/build-plan.md) (tracker).

## Why

The project's premise is that **identity is a portable AT Protocol account —
there is no separate username/password system** (README, `docs/architecture.md`).
PHASE 4 nonetheless introduced `Creator.slug`: an app-owned, mutable vanity
string with its own uniqueness constraint, reserved-word list and rate-limited
change flow. That is a second identity layer bolted onto a portable one, and it
is the only app-owned name anywhere in the system (subscribers already carry
none).

Remove it. The **AT Protocol handle is the public identity** for every user —
creator and subscriber alike — and the **DID is the durable key** underneath.
A creator's page is `/c/<handle>` (and `/c/<did>` always resolves). Handles are
rented DNS names and can change; when one does, foryour.fans follows the DID and
**old `/c/<oldhandle>` links redirect** rather than 404.

## The rule (holds after this refactor, in every later phase)

1. No app-owned usernames, slugs, or display-name-uniqueness anywhere. The only
   public name is the AT handle; the only stable internal key is the DID.
2. Every public creator URL is `/c/<handle>` or `/c/<did>`. `/c/<did>` never
   breaks. `/c/<oldhandle>` 301/redirects to `/c/<currenthandle>` after a
   handle change (mechanism: "Handle sync" + `GET /creators/:identifier` step 3
   in the Backend section).
3. Anywhere a user is shown (creator page, comments, subscriber lists,
   dashboard, admin console) the display identity is `@handle`, keyed by DID.
4. `POST /creators` takes profile fields only; becoming a creator is "mark this
   DID a creator + publish `fans.foryour.profile`", nothing more.

---

## Backend (`apps/api`, `packages/*`)

### Database (`packages/database`)

- New migration: drop `Creator.slug`, its `UNIQUE` index, and `slugUpdatedAt`.
  `Creator` becomes `{ id, userId, did UNIQUE, status, verificationStatus,
  createdAt, updatedAt }` plus whatever later phases added — no `slug`.
- New model `CreatorHandleHistory` (or equivalent):

  ```text
  CreatorHandleHistory
  id
  creatorId        -> Creator
  did              (denormalized for lookup without a join)
  previousHandle   (lowercased)
  recordedAt
  @@index([previousHandle])
  ```

  Retained indefinitely (rows are tiny). Written by the sync path below.

### Handle sync (`packages/auth` `syncUserFromProfile`, or its caller)

- `syncUserFromProfile` already overwrites `User.handle` from the PDS on every
  login. When it changes `handle` for a DID **that has a `Creator` row**, append
  a `CreatorHandleHistory` row for the *previous* handle before overwriting.
- No new network calls on any hot path — this piggybacks on the existing
  login-time profile sync. Cross-session/real-time handle tracking is still
  PHASE 10's job.

### Creator service & routes (`apps/api/src/services/creators.ts`, `routes/creators.ts`)

- Delete `SLUG_PATTERN`, `RESERVED_SLUGS`, `validateSlug`, `SlugValidationError`,
  `SlugTakenError`, `SlugCooldownError`, `SLUG_CHANGE_COOLDOWN_MS`, and all
  slug-change logic in `updateCreator`.
- `POST /creators` body: `{ displayName?, bio?, website? }` (all optional; an
  empty body is valid). Still: AT-record-publish-before-DB-write ordering,
  one-creator-per-user, ownership by construction. On success return the
  `/creators/me` shape (no `slug`).
- `PATCH /creators/me` body: `{ displayName?, bio?, website? }` — profile only.
- `GET /creators/:identifier` — resolve in this order:
  1. `identifier` starts with `did:` → look up `Creator` by `did`.
  2. otherwise treat as a **handle** (lowercase it): find the `Creator` whose
     `User.handle` currently equals it (existing cached-handle resolution —
     keep it; no live PDS lookup on this hot path).
  3. **no current match** → look in `CreatorHandleHistory` for
     `previousHandle == identifier`. If found, resolve to the creator who holds
     that handle-lineage's DID *now* (the history row's `did`), and return a
     **`301`** with `Location: /creators/<currentHandle>` **and** a body of
     `{ movedTo: "<currentHandle>", did }` so non-redirect-following clients
     (the web SSR layer) can act on it.
     - If several history rows share a `previousHandle` (a handle freed and
       re-registered by a different DID over time), prefer the row whose `did`
       still has that as a *former* handle and is otherwise unresolved; if
       genuinely ambiguous, pick the most recent `recordedAt`. Document the
       choice.
  4. still nothing → `404`.
- The `toPublicCreator` / `toOwnCreator` shapes lose `slug`; add nothing.
- Any other route that took or returned a creator `slug` (feeds, tiers,
  discovery scaffolding, tests) switches to `handle` / `did`.

### Tests

- Update `apps/api/test/creators.test.ts` (and any tier/feed tests) to drop
  slug assertions and the reserved-word / cooldown cases.
- Add: `POST /creators` with an empty body succeeds; `GET /creators/:handle`
  resolves; `GET /creators/:did` resolves; after a simulated handle change
  (update `User.handle`, insert a history row via the sync path),
  `GET /creators/<oldhandle>` returns `301 { movedTo }` and
  `GET /creators/<newhandle>` / `GET /creators/<did>` resolve directly.
- `apps/api/test/e2e/fakeServer.ts`: the fixture flow no longer sends a slug.

### Docs

- `docs/architecture.md`: replace the "Slugs" section with "Creator page
  address" — handle-as-identity, DID as durable key, the handle-history redirect,
  and why there is no app-owned username.
- `docs/atproto-vs-database.md`: drop `slug` from the `Creator` row description.
- `README.md`: remove slug from the `Creator` model and the "claim a slug"
  wording in Getting Started; note `/c/<handle>` (and `/c/<did>`).

**Stop after the backend refactor. Verify: `pnpm build`, `pnpm -r lint`,
`pnpm -r typecheck`, `pnpm -r test` all green; the `301`/`movedTo` behavior
covered by a test.**

---

## Web (`apps/web`)

Consumes the refactored API above.

### `/become-a-creator` — onboarding wizard

- Drops the **Slug** step. Three steps: **Profile** (display name, bio, website)
  → **Content rating** (self-attest placeholder, unchanged) → **Review &
  publish**.
- Review copy: "Your page will be **`/c/<your-handle>`**" — derived from the
  session handle, not entered. Submit `POST /creators` with profile fields only.
- Delete `SlugStep.tsx`, `lib/slug.ts`, `lib/useSlugAvailability.ts`, and their
  tests.

### `/c/[handle]` — public creator page

- Rename the dynamic segment `app/(marketing)/c/[slug]` → `app/(marketing)/c/[handle]`.
  The segment value is a **handle or a DID** (URL-encoded for `did:` colons).
- `GET /creators/:identifier` handling:
  - `200` → render as today (banner, avatar, `@handle`, bio, website,
    member-since; owner `Edit` affordance; `EmptyState` tiers/posts; disabled
    `Subscribe`).
  - `301` with `{ movedTo }` → server `redirect('/c/<movedTo>')` (permanent).
  - `404` → the existing friendly "this creator isn't available" state.
- Owner check stays a DID comparison (`session.user.did === creator.did`).
- Every generated creator link uses `/c/<handle>`; use `/c/<did>` only where the
  handle isn't known to the caller.

### `/creator/settings`

- Remove the "Page address" card and `SlugChangeDialog.tsx` (+ its test).
- Add a short static note: "Your page address follows your AT Protocol handle
  (`/c/<handle>`). Change your handle with your identity provider / PDS —
  foryour.fans picks it up on your next sign-in and old links redirect. Your
  `/c/<did>` address never changes."
- Keep the profile-edit form and the "last published to your PDS" indicator.

### Cross-cutting

- Anywhere a user/creator/commenter is displayed, show `@handle` keyed by DID
  (already true for subscribers — confirm in comments/dashboard/admin as those
  phases land).
- `docs/ux.md`: update the `/become-a-creator`, `/c/[handle]`, `/creator/settings`
  rows and the state matrix; note the removed slug flow.
- Remove the "slug rules" reference from `web.md`'s tech-choices `packages/shared`
  line (done in this file's web.md edits, but re-check nothing in `apps/web`
  still imports a shared slug schema).

### Tests

- Delete slug-specific unit tests; update `OnboardingWizard` tests for the
  3-step flow.
- Playwright: the become-a-creator spec no longer fills a slug and asserts the
  landing URL is `/c/<fixture-handle>`; add a spec that visiting a stale
  `/c/<oldhandle>` (simulate via the fake API's history) 308-redirects to the
  current handle.

**Stop after the web refactor.**

---

## Exit checklist (whole refactor)

1. `packages/database` migration applies cleanly forward; `Creator.slug` and
   `slugUpdatedAt` gone; `CreatorHandleHistory` present.
2. `pnpm -r lint` / `pnpm -r typecheck` / `pnpm -r test` green (api + web).
3. `pnpm --filter @foryour-fans/web` lint / typecheck / build / test green;
   Playwright green.
4. `grep -ri "slug" apps packages` returns only unrelated hits (no
   `Creator.slug`, no `SLUG_PATTERN`, no `/c/:slug`).
5. `GET /creators/<did>` and `GET /creators/<handle>` resolve; a changed handle
   yields a `301 { movedTo }` from the API and a `redirect()` from `/c/[handle]`.
6. `docs/architecture.md`, `docs/atproto-vs-database.md`, `README.md`,
   `docs/ux.md`, `docs/build-plan.md` updated.
7. files-changed summary; known limitations; confirm PHASE 8 / WEB PHASE 5 are
   unblocked.

Do not continue past this line into PHASE 8 / WEB PHASE 5.
