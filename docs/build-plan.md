# Build Plan

Companion to [`prompts/full.md`](../prompts/full.md), the phase-by-phase spec fed to Codex. That file is the source of truth for *what* to build in each phase; this file is the project-tracking view — one row per phase, in build order, with the exit criteria and open decisions that don't belong in the spec itself.

Two decisions locked in during spec review (2026-09-01), both reflected in `prompts/full.md`:

- **Hosting model**: the app never operates its own PDS. Users bring their own AT Protocol identity; public records are written to *their* repo via OAuth-scoped writes, never to an app-controlled one.
- **Content policy**: adult/NSFW creator content is in scope. This rules out assuming Stripe as the eventual `PaymentProvider`/`PayoutProvider`, and pulls creator KYC/age-verification forward from "future work" to a gating design requirement (Phase 14, enforced starting Phase 6's payout onboarding).

Each phase below ends with the standard exit checklist from `prompts/full.md`: tests pass, lint passes, type check passes, app starts, README updated, `docs/architecture.md` updated, files-changed summary, known limitations documented, next phase identified. Not repeated per-row.

**Status (2026-09-01): Phases 1–4 done.** Phase 2 verified end-to-end against the live AT network: real handle resolution (`bsky.app`), a real Pushed Authorization Request to `bsky.social`, and a full fake-OAuth-client callback→session→cookie round trip (12 automated tests, including identity creation vs. returning-user login, CSRF-protected logout). Phase 3 lexicons (`dev.creator.profile/post/tier`) are authored, generated, and validated (16 tests). Phase 4 wires `dev.creator.profile` into real routes for the first time (`POST /creators`, `PATCH /creators/me`) with AT-write-before-DB-write ordering, slug validation/cooldown, and ownership-by-construction (`/creators/me` never accepts a creator id from the client) — 15 route tests plus a caught-and-fixed real bug (the slug-change cooldown originally blocked a creator's very first edit). `/become-a-creator`, `/creator/settings`, `/c/[slug]` are live. Phases 5–17 not started.

| # | Phase | Builds | Exit criteria (beyond the standard checklist) | Depends on |
|---|-------|--------|------------------------------------------------|------------|
| 1 | Repository Foundation | pnpm monorepo, Fastify API skeleton, Prisma `User` model, Docker Compose (Postgres/Redis/MinIO), Next.js shell, CI workflow | `/health` and `/ready` pass against real Postgres; CI runs lint/typecheck/test/build on PR | — |
| 2 | AT Identity & OAuth | Handle→DID→PDS resolution, AT OAuth (PKCE + DPoP), server-side sessions | Returning-user login test passes; no app passwords or Bluesky app passwords ever stored | 1 |
| 3 | Custom Lexicons | `dev.creator.profile/post/tier` lexicons, generated types, blob-upload path to user's own PDS | Validation tests pass; `docs/architecture.md` states which fields live in AT vs. our DB | 2 |
| 4 | Creator Accounts | `Creator` (no separate `CreatorProfile` table needed — see docs/atproto-vs-database.md), slug rules + reserved words + cooldown, ownership-by-construction | A user cannot PATCH another creator's account (test); slug collision/reserved-word rejected | 2, 3 |
| 5 | Subscription Tiers | `SubscriptionTier` CRUD, price-change grandfathering rule | Deactivating a tier doesn't break existing subscribers' historical data | 4 |
| 6 | Subscription & Payment Abstraction | `PaymentProvider`/`PayoutProvider` interfaces + fake implementations, `Subscription`/`PaymentEvent` models with price snapshot fields, entitlement service, **payout onboarding routes** | Idempotent webhook test (replay same event twice → one effect); `canAccess` uses the snapshotted tier price, not live price | 5 |
| 7 | Private Content Architecture | `ContentRepository` interface, `PrivateContentRepository` (Postgres+S3), `Post` model, `PostMedia` join table, entitlement-gated routes | All 5 access-control test cases in the spec pass (anon, non-subscriber, valid subscriber, wrong-tier, creator-self) | 6 |
| 8 | Secure Media | Presigned upload/download flow, `MediaAsset` with explicit status lifecycle (`pending_upload→processing→ready`/`rejected`) | `GET /media/:id/access` never issues a signed URL for a non-`ready` asset, even to an entitled subscriber | 7 |
| 9 | Feeds | `/feed`, `/creators/:creator/feed`, locked-post metadata-only responses | Locked-post payload contains no body/media data (test) | 7, 8 |
| 10 | AT Public Discovery | Ingestion (Jetstream/repo sync), tombstone/delete handling, `/discover`, `/search` | A record deleted upstream disappears from the index, not just new records get added | 3, 9 |
| 11 | Spaces Experimental Adapter | `AtprotoSpacesContentRepository`, `SpaceAuthority` gated by `ATPROTO_SPACES_ENABLED=false` | Flag defaults false in every environment config; entitlement service remains sole authority | 7 |
| 12 | Comments, Likes, Social | `Comment`/`Like`, access inherited from parent post | Comment on tier-gated post is itself gated the same way (test) | 7 |
| 13 | Creator Dashboard | Revenue/subscriber analytics, ownership-protected | MRR computed from billing DB, not AT records; uses price snapshot from Phase 6 | 6, 6-payout |
| 14 | Trust & Safety Foundation | `Report`/`ModerationCase`/`ContentLabel`/`UserBlock`/`AuditLog`, verification-status field on `Creator`, moderation gates on payout/adult-content posting | Real (non-fake) `PaymentProvider`/`PayoutProvider` cannot be enabled while verification status is unresolved (design-level gate, documented) | 6, 8 |
| 15 | Production Hardening | Rate limiting, security headers, DB constraints/indexes, webhook replay/out-of-order tests, `docs/security.md`, `docs/threat-model.md`, `docs/production-readiness.md` | Documented attempt to bypass signed URLs / tier restrictions fails | all above |
| 16 | Kubernetes Deployment | Manifests (base + overlays), no in-cluster Postgres/S3 by default | Secrets never committed; readiness/liveness probes present for API and Web | 15 |
| 17 | Architecture Review | `docs/final-architecture.md` with the 5 required diagrams, risk list, MVP-readiness classification | No new features added — review only | all above |

## Known deliberate gaps (not scheduled in any phase above)

Carried over from the spec review — intentionally out of scope of `prompts/full.md`, called out so they aren't mistaken for oversights later:

- **Transactional email/notifications** (receipts, cancellation confirmations, payout failures, moderation notices). Needed before real-money production launch; not in any phase.
- **Real payment/payout processor selection.** Phase 6 builds the abstraction and a fake implementation only; picking an actual adult-content-compatible processor is a business decision, not a Codex phase.
- **Video transcoding, thumbnailing, virus/moderation scanning implementations.** Phase 8 designs the interface and status lifecycle; it does not implement these.
- **Frontend/e2e test tooling** (e.g. Playwright). The spec only requires API-level tests throughout; add this explicitly if/when frontend correctness needs automated coverage.

## Suggested next step

Start Phase 1. Each phase should be run as its own Codex session against the corresponding section of `prompts/full.md`, stopping where that phase says to stop — do not let a session continue into the next phase's scope even if it seems trivial to keep going.
