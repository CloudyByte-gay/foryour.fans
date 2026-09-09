# Production readiness

Phase 15 (Production Hardening) deliverable — companion to `docs/security.md` (what was hardened, and how) and `docs/threat-model.md` (what threats were considered). This is a checklist of what this phase actually verified or fixed, honestly scoped: it covers *this phase's* mandate (`prompts/full.md` PHASE 15's Authentication/Authorization/Media security/Billing/Database/API/Observability sections), not a full launch readiness review — that's `prompts/full.md` PHASE 17's job (`docs/final-architecture.md`, with the required risk list and MVP-readiness classification), and container/cluster deployment is PHASE 16's.

Per PHASE 15's own instruction, **no new product features were added** in this phase — every change below is hardening, a fix to something already built, or a new document.

## Authentication — reviewed, no code changes needed beyond what's documented

- OAuth state (CSRF-on-login) — real, server-side, TTL'd. ✅
- PKCE — enforced unconditionally by `@atproto/oauth-client-node`, not optional application code. ✅
- DPoP-bound tokens — `dpop_bound_access_tokens: true`. ✅
- Session cookie settings (`httpOnly`, `secure` in production, `sameSite: lax`) — correct. ✅
- Login CSRF — mitigated by OAuth state. ✅
- Session theft — mitigated for XSS (`httpOnly`) and network interception (`secure`+TLS); IP/UA binding deliberately not implemented (see `docs/threat-model.md`'s "Accepted risks"). ✅ (with a documented trade-off)
- Session rotation on privilege change — unnecessary by design (no mutable privilege field is ever cached on the session; see `docs/security.md`). ✅

## Authorization — one gap found and fixed

- Ownership-by-construction pattern verified across every route file, including the ones not previously reviewed in earlier phases (`comments`, `likes`, `feed`, `contentKeys`, `reports`, `blocks`, `creatorBlocks`, `verification`, `admin`, `discovery`, `dashboard`, `webhooks`, `health`, `ready`). ✅
- **Fixed:** `POST /creators/me/blocks` was missing `requireNotRestricted` — a restricted creator could still ban users from their content. See `docs/security.md`'s "Findings and fixes." ✅ (fixed, regression-tested)
- Admin route gating (`requireAdmin`, fresh DB read every call) — correct. ✅
- No self-service or peer-to-peer path to `ADMIN` — confirmed, `ADMIN_DIDS` env var is the only path. ✅

## Production deployment guards — a real, previously-open gap closed this phase

`prompts/security-hardening.md`, a standalone hardening spec this repository had never actually run, flagged three concrete issues. Verified/fixed this phase:

- ✅ **Fixed:** `NODE_ENV=production` now refuses to boot with `PAYMENT_PROVIDER=fake` or `PAYOUT_PROVIDER=fake` — previously `server.ts` wired `FakePaymentProvider`/`FakePayoutProvider` unconditionally with no production guard at all. No break-glass override exists, deliberately.
- ✅ **Fixed (as a consequence of the above):** a forged `/webhooks/fake` delivery can no longer reach a production deployment — `paymentProvider.name` can never be `"fake"` there.
- ✅ **Fixed:** `NODE_ENV=production` now also refuses to boot with `CREATOR_OWNED_GATED_CONTENT_ENABLED=true`.
- ✅ **Already resolved before this phase:** the spec's second issue, `GET /media/:id/access` authorizing by "any active subscription" rather than post-level entitlement — current code already requires passing the exact per-post `checkPostAccess` gate; see Media security below.

See `docs/security.md`'s "Production deployment guards" for the full writeup and `apps/api/test/env.test.ts` for the tests.

## Media security — verified with a dedicated bypass-attempt test suite

- Signed URL scope and TTL (60s download / 5min upload, single object key) — correct. ✅
- Tier-restriction bypass attempts (wrong tier, no subscription, anonymous) — all denied, existing + new tests pass. ✅
- **New this phase:** subscription-expiration bypass — a subscriber who loses `ACTIVE` status (payment failure) loses media access on their very next request, verified end-to-end through a real webhook delivery. ✅
- Creator-ownership bypass attempts (one creator acting on another's upload/asset) — denied, existing tests pass. ✅

## Billing — hardened, four new behaviors added and tested

- Webhook idempotency (replay of the same event) — pre-existing, re-verified. ✅
- **New:** out-of-order event rejection (`lastWebhookEventAt`) — a stale, late-arriving status transition can no longer undo a newer one. ✅
- **New:** `payment.failed` event type, mapped to `PAST_DUE` (immediate access denial, no grace period, consistent with existing `canAccess` semantics). ✅
- **New:** `payment.refunded` event type, mapped to `CANCELED` (immediate access revocation, not deferred to period end). ✅
- Cancellation (`cancelAtPeriodEnd`) — pre-existing, re-verified; provider is told not to renew, access holds through the paid period. ✅
- Refund *state* specifically — now modeled as an immediate `CANCELED` transition rather than left unhandled (previously, no refund event type existed in the webhook vocabulary at all). ✅

## Database — indexes, constraints, and one referential-integrity fix

- `Subscription.lastWebhookEventAt` — new column, out-of-order support. ✅
- `Subscription`'s `@@index([creatorId])` — new; the dashboard/revenue query path was filtering by `creatorId` alone with no index whose leading column matched it. ✅
- `ContentKeyGrant.subscriptionId` → `Subscription.id` foreign key — new; was previously an unenforced bare column. ✅
- Three `CHECK` constraints (`subscription_tiers.priceCents > 0`, `subscriptions.priceCentsAtSubscription > 0`, `media_assets.size > 0`) — new, defense-in-depth mirroring existing application-level validation. ✅
- Migration: `20260907234804_phase15_hardening`, applied and verified against a real Postgres instance; full test suite green after. ✅

## API layer — three new protections

- Rate limiting (`@fastify/rate-limit`, Redis-backed, global default + a strict per-route override on the OAuth-start route) — new. ✅
- Request body size limit (256 KiB) — new, explicit (previously Fastify's un-discussed 1 MiB default). ✅
- Security response headers (`@fastify/helmet`) — new; verified against a real running server. ✅
- Schema validation (zod on every body-accepting route) — pre-existing, re-verified during the route audit, no gaps found. ✅
- CORS (explicit origin allowlist, credentialed) — pre-existing, unchanged. ✅

## Observability — three additions, one gap closed

- **New:** `GET /metrics` — Prometheus exposition format, default Node.js/process metrics plus a per-request duration histogram (method/route/status_code). Exempt from rate limiting and session resolution, same as `/health`/`/ready`.
- **Fixed:** `/ready` previously checked Postgres only, despite Redis being a real, hard dependency (sessions, OAuth state, rate-limit counters). Now checks both, reporting which one failed.
- **New:** `ErrorReporter` interface (`apps/api/src/errorReporting.ts`) with a real, logging-based implementation (`LoggingErrorReporter`) — the seam a future Sentry/Bugsnag/APM integration plugs into with zero call-site changes, same DI pattern as `PaymentProvider`/`MediaProcessor`.
- Structured logging with a request id on every line — pre-existing, unchanged, confirmed still correct.
- Liveness (`/health`) and readiness (`/ready`) both verified to still never depend on session resolution, and both confirmed exempt from the new rate limiter (a probe/scraper must never be throttled into a false-negative reading).

## Verified end-to-end, this phase's exit checklist

- `pnpm build` / `pnpm -r lint` / `pnpm -r typecheck` / `pnpm test` all green across the full workspace (apps/api gained 20 tests: rate-limit behavior, `/ready`'s Redis check, `/metrics`, the `ErrorReporter` wiring, the media-expiration bypass test, and the creator-block restricted-user fix; `packages/subscriptions` gained 10 webhook tests).
- The compiled server actually starts (`node dist/server.js`) against a real Postgres + Redis, and `curl -i /health` / `/ready` confirm the new security headers are present and rate-limit headers are absent (correctly exempted).
- No product feature changed behavior for an existing, entitled user — every fix and addition is either a closed security gap, a new protective layer, or documentation.

## What remains open (by design — not this phase's job)

- **Real payment/payout processor integration and its own security review** — `prompts/full.md` Phase 6's business decision, still deferred; `FakePaymentProvider`/`FakePayoutProvider` are the only implementations, and real money never moves through this codebase today.
- **Container/cluster hardening** (network policies, secrets management, pod security, a real edge/DDoS layer) — `prompts/full.md` PHASE 16 (Kubernetes Deployment).
- **A full risk register and MVP-readiness classification** — `prompts/full.md` PHASE 17 (`docs/final-architecture.md`).
- **Legal/compliance items** (NCMEC/DMCA filing, subscriber age verification, consent records, geo-restriction, a real KYC vendor, a real network-registered labeler service) — unchanged from Phase 14, explicitly not this phase's job to close; see `docs/architecture.md`'s Phase 14 section.
- **Per-account (rather than per-IP) rate limiting**, and a dedicated (rather than shared) webhook rate-limit budget — considered and deliberately deferred; see `docs/threat-model.md`'s "Accepted risks / deliberate trade-offs."
- **Transactional email/notifications** (payment failure, refund, moderation actions) — out of scope for every phase in `prompts/full.md`, unchanged.
- **A Next.js 14→15 major-version upgrade** — the 14.x line (patched here to `14.2.35`) has no fix for several framework-level DoS/SSRF advisories that `>=15.5.x` carries; see `docs/security.md`'s "Independent security review" section and `docs/threat-model.md`'s "Accepted risks" for which of those are actually reachable given this app's feature usage, and why the upgrade itself (Next 15's async `cookies()`/`headers()`/`params`/`searchParams` APIs) wasn't attempted as part of that review.
