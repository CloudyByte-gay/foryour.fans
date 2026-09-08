# Final Architecture Review

`prompts/full.md` **PHASE 17** deliverable. This is a review phase — **no new
features were added.** It consolidates the system as built across Phases 1–16
(plus the Handle-as-Identity refactor and the two post-Phase-10 rearchitecture
specs), draws the required end-to-end diagrams, enumerates the risks a
production launch faces, and ends with an MVP-readiness classification.

Companion documents, still authoritative for their own areas — this file
summarizes and cross-references rather than restating them:

- [`docs/architecture.md`](./architecture.md) — the phase-by-phase design record and every "why".
- [`docs/security.md`](./security.md) / [`docs/threat-model.md`](./threat-model.md) / [`docs/production-readiness.md`](./production-readiness.md) — Phase 15 hardening.
- [`docs/atproto-vs-database.md`](./atproto-vs-database.md) — the AT-Protocol-vs-Postgres data-placement rules.
- [`docs/creator-owned-pds.md`](./creator-owned-pds.md) / [`docs/bluesky-public-posts.md`](./bluesky-public-posts.md) — the rearchitecture research.
- [`docs/ux-review.md`](./ux-review.md) — `prompts/web.md` WEB PHASE 17, the web client's own review.
- [`infrastructure/kubernetes/README.md`](../infrastructure/kubernetes/README.md) — deployment shape and what was actually verified.

## Review scope and method

Every route file (`apps/api/src/routes/*`), every domain package
(`packages/*/src`), the app wiring (`apps/api/src/app.ts`, `server.ts`,
`ingest.ts`), the Prisma schema, the env/config surface, and the web client's
server/client boundary were read in full. `pnpm build` / `-r lint` /
`-r typecheck` / `-r test` were run and are green. A `TODO`/`FIXME`/`@ts-ignore`
grep across all non-test source returns **zero hits** in `apps/api` and
`packages/*`; the three `eslint-disable` lines in `apps/web` are all documented
accessibility exceptions (`docs/web-accessibility.md`).

**No material architectural or security defect was found that Phase 15's
hardening pass or the WEB PHASE 15 audit had not already found and fixed.** The
one change this phase makes is documentation: this file and `docs/ux-review.md`.
Everything below that reads as a "risk" is either a already-documented accepted
trade-off, or work that is deliberately out of scope until a business decision
(a real payment processor) or a compliance decision (KYC/age-verification
vendors, a labeler service) is made.

---

## System shape

A pnpm-workspace **modular monolith** (per the spec's explicit preference — no
microservices). Two deployable apps, ten library packages, one long-lived
consumer process.

```
                         ┌──────────────────────────────────────────────┐
   Browser ──────────────▶  apps/web  (Next.js 14 App Router)            │
   (session cookie,       │   • Server Components → API over             │
    same-origin)          │     API_INTERNAL_URL (Cookie forwarded)      │
                          │   • Client Components → /api/* same-origin   │
                          │     rewrite → API                            │
                          │   • middleware.ts: per-request CSP nonce     │
                          └───────────────┬──────────────────────────────┘
                                          │  HTTP (same origin in prod: one ingress)
                                          ▼
   Payment provider ──────▶  apps/api/src/server.ts  (Fastify 5)
   POST /webhooks/:provider │   • @fastify/helmet, cors, rate-limit (Redis-backed)
   (no cookie, own scope)   │   • sessionPlugin scope (Redis lookup) wraps
                            │     every authenticated route
                            │   • /health /ready /metrics /webhooks /discover
                            │     deliberately outside that scope
                            └───┬───────────────────────────────────────────┐
                                │                                           │
     ┌──────────────────────────┼───────────────────────┐                   │
     ▼                          ▼                        ▼                   ▼
 packages/auth            packages/subscriptions   packages/content     packages/media
  app sessions (Redis)     tiers, Payment/Payout    ContentRepository    ObjectStorage
  AT OAuth token stores     Provider + fakes,        interface:           interface:
  (Postgres, per-DID)       webhooks, entitlements,   • PrivateContent…    • S3ObjectStorage (real)
                            dashboard, key grants     • CreatorOwned…      • FakeObjectStorage (test)
     │                          │                     • AtprotoSpaces…     MediaProcessor hook
     ▼                          ▼                       (stub)                 │
 packages/atproto        packages/moderation        packages/lexicons         ▼
  handle/DID/PDS resolve   Report/Case/Label/Block   fans.foryour.* schemas  S3-compatible
  AT OAuth client          AuditLog, verification,   + NSIDs (compile-time)  object storage
  record read/write        ContentClassifier hook    vendored app.bsky.*     (MinIO / R2 / GCS)
  bskyPost / bskyBlock                                 for pinning only
     │                          │                          │
     └──────────────┬───────────┴──────────────────────────┘
                    ▼
             packages/database (Prisma) ──▶ PostgreSQL
             packages/shared  (Redis client, Did brand type)


  apps/api/src/ingest.ts  (SEPARATE single-instance process, same package)
     └─▶ packages/discovery  (JetstreamIngestor → wss://jetstream.*.bsky.network)
              • parse → applyCommitEvent → IndexedCreatorProfile / IndexedPost / IndexedTier
              • cursor persisted (time_us) in IngestionCursor
              • NEVER consulted for canAccess / entitlement
     └─▶ packages/atproto (resolveDid)  └─▶ packages/database ──▶ PostgreSQL
```

**Three stores, three lifetimes** (deliberately not conflated):

| Store | Backend | Holds | Revocation |
|---|---|---|---|
| App login session | Redis, opaque 32-byte token in `ff_session` | DID, CSRF token, `createdAt` — all server-side | delete the Redis key |
| AT OAuth grant | Postgres `AtprotoOAuthSession`, keyed by DID | DPoP-bound access/refresh tokens for the user's own PDS | outlives any browser session by design (background writes) |
| OAuth redirect state | Redis, 10-min TTL | PKCE/CSRF state for the redirect round trip only | expires |

**Data placement** is governed by one rule enforced at a single choke point per
concern, not per route (`docs/atproto-vs-database.md`): only `PUBLIC` posts,
`fans.foryour.profile`, and `fans.foryour.tier` become AT records, written into
the **user's own repo** via their OAuth grant; `SUBSCRIBERS`/`TIER` post bodies,
all billing state, all moderation data, comments, and likes are Postgres-only,
full stop. Private media bytes live only in app-controlled S3-compatible storage
and never touch any PDS.

---

## Diagram 1 — Authentication

```
AT account (handle: alice.bsky.social, on any PDS)
        │
        │  POST /auth/atproto/start   { handle }
        ▼
apps/api  ── resolveHandle → DID → PDS  (packages/atproto, @atproto/identity)
        │   NodeOAuthClient: PKCE + DPoP key + Pushed Authorization Request
        │   state stored in Redis (10-min TTL, createRedisStateStore)
        ▼
   authorization server (the user's own PDS, e.g. bsky.social)
        │   user consents to the `atproto` + write scope
        ▼
GET /auth/atproto/callback   ?code=…&state=…
        │   • validate state (Redis)   • PKCE verifier   • DPoP
        │   • token exchange → OAuthSession (stored in Postgres, keyed by DID)
        │   • fetchProfile → syncUserFromProfile → upsert User (DID canonical;
        │       handle/displayName/avatar are cached, mutable, re-synced)
        │   • adminBootstrap: if DID ∈ ADMIN_DIDS, set User.role = ADMIN (idempotent)
        │   • CreatorHandleHistory: if handle changed & DID has a Creator row,
        │       append the previous handle (drives /c/<oldhandle> 301 redirects)
        │   • mint app session (Redis) → Set-Cookie ff_session (HttpOnly,
        │       Secure in prod, SameSite=Lax) + ff_csrf (readable, double-submit)
        ▼
   302 → <PUBLIC_URL>/auth/callback   (± ?error=<code>)
        │
        ▼
apps/web /auth/callback  ("Finishing sign-in…")
        ├─ error=access_denied → "Sign-in cancelled"
        ├─ stored safe `next`  → replace(next)
        ├─ GET /creators/me 404 → /dashboard?welcome=1
        └─ otherwise            → /dashboard

Every later authenticated request:
   Browser ──ff_session cookie──▶ sessionPlugin onRequest hook (Redis GET)
        → request.session = { did, csrfToken }   (or 401)
   Mutating routes additionally: requireCsrf (x-csrf-token header === session store)
   Admin routes: requireAdmin  (fresh User.role read from Postgres, every call)
   Harm-capable writes: requireNotRestricted  (fresh User.status read, every call)
```

Identity invariant: **the DID is the only identifier the system keys on.** The
handle is a rented DNS name; `User.handle`, `Creator.displayName`, index rows —
all treat it as a mutable pointer. `/c/<did>` never breaks; `/c/<handle>`
survives a handle change via `CreatorHandleHistory` → `301 { movedTo, did }`.

No password, app-password, or credential of any kind is ever seen or stored.
PKCE is enforced unconditionally by `@atproto/oauth-client-node`; tokens are
DPoP-bound. `ATPROTO_OAUTH_MODE=loopback` is refused under `NODE_ENV=production`.

---

## Diagram 2 — Public content

```
Creator edits profile / tier / publishes a PUBLIC post
        │
        ▼
apps/api  services/creators.ts | packages/subscriptions/tiers.ts |
          packages/content PrivateContentRepository.createPost
        │   ORDER IS DELIBERATE: publish the AT record FIRST, write Postgres SECOND.
        │   A local row must never exist without its published AT record.
        │   AT write fails → 502, nothing persisted.
        ▼
User's OWN PDS  (com.atproto.repo.putRecord via the OAuth grant)
   • fans.foryour.profile   (rkey "self")
   • fans.foryour.tier      (rkey = minted-once TID, reused on every edit)
   • fans.foryour.post      (rkey = minted-once TID; PUBLIC only)
        │
        ▼
Open AT network  (relays, other AppViews, bsky.app if dual-published)
        │
        ▼
Jetstream firehose  wss://jetstream.us-east.bsky.network/subscribe
        │   ?wantedCollections=fans.foryour.profile,fans.foryour.post,fans.foryour.tier
        ▼
apps/api/src/ingest.ts  (separate process)  packages/discovery
   • parseJetstreamMessage → CommitEvent | null   (never throws)
   • applyCommitEvent → upsert / delete IndexedCreatorProfile | IndexedPost | IndexedTier
   • create/update/DELETE all handled (tombstones remove indexed rows)
   • resolveDid to refresh the current handle opportunistically
   • cursor (time_us) persisted → resumable across restarts / instances
        │
        ▼
GET /discover  /search   (apps/api/src/routes/discovery.ts)
   • DID-keyed rows, network-wide (covers DIDs that never signed in here)
   • enriched with isRegisteredCreator (batched local Creator lookup)
   • NEVER used for canAccess
        │
        ▼
apps/web  /discover  /search  /  (Featured strip)  — CreatorCard grid, cursor-paginated
```

Consequences the design accepts: the app cannot unilaterally edit or delete a
user's public record (only issue an authorized write/delete through their
grant); propagation of deletes across the open network is best-effort;
`identity` firehose events are deliberately **not** subscribed to (no
server-side way to scope them to indexed DIDs — bandwidth cost unbounded), so
index handle currency lags a creator's own commits.

**Dual-published public posts** (rearchitecture spec 2, implemented,
flag-gated behind `CREATOR_OWNED_PDS_ENABLED`): a `PUBLIC` post is written as
`app.bsky.feed.post` **first**, then `fans.foryour.post` carrying
`bskyUri`/`bskyCid`/`canonicalUri` (one-way link). A failed custom write rolls
back the Bluesky record. `packages/discovery/mergeIndexedPosts` collapses the
pair into one feed item. Default flags: off — the only default-on change is
nullable `foryourAt*`/`bskyAt*`/`canonicalUri`/`sourceCollections` fields on API
post responses.

---

## Diagram 3 — Paid content

```
Creator uploads media                    Creator publishes a SUBSCRIBERS / TIER post
        │                                        │
POST /media/upload-url                    POST|PATCH /creators/me/posts  { visibility,
   MediaAsset row (PENDING_UPLOAD)             text, minimumTierId?, media:[{id,sortOrder}] }
   presigned PUT (5-min TTL)                    │  resolvePostMedia: every id must be a
        │                                       │  READY MediaAsset owned by this creator,
   browser PUT → object storage                 │  ≤ MAX_POST_MEDIA, sortOrder re-packed
        │                                       ▼
POST /media/:id/complete                  PrivateContentRepository.createPost
   PROCESSING → MediaProcessor →             • Postgres-only (NO AT record — the choke
   READY | REJECTED                            point decides, not the route)
        │                                     • PostMedia join rows
        └───────────────┬─────────────────────┘
                        ▼
              Subscriber requests content
                        │
        ┌───────────────┴───────────────────────────────┐
        ▼                                               ▼
GET /posts/:id                                  GET /media/:id/access
   checkPostAccess(viewer, post):                  getReadyMediaAsset (status READY only —
     • creator of the post → allow                    a REJECTED asset never yields a URL,
     • canAccess(subscriberDid, creatorDid,             for anyone, incl. its own creator)
        requiredTierId):                             then the SAME checkPostAccess as
        - ACTIVE subscription only (PAST_DUE           GET /posts/:id, against EVERY post
          fails closed — no grace)                     the asset is attached to (≥1 must pass);
        - SubscriptionTier.sortOrder hierarchy         attached to nothing → creator only
          (higher tier reads lower-gated content)   → 60-second signed download URL
     • denied → 200 locked stub (id, visibility,       (re-checked live on every fetch;
        createdAt, requiredTier, hasMedia —            never cached from a prior success)
        NEVER text/media)   [/posts/:id]
     • denied → 403         [comments / likes, via loadAccessiblePost]
```

`ContentRepository` is **pure storage** — it has no viewer/entitlement
parameter, by design (Phase 7's own interface). Entitlement lives in exactly one
function, `canAccess` (`packages/subscriptions/entitlements.ts`), called from
`checkPostAccess` (`routes/posts.ts`), reused by `feed.ts`, `comments.ts`,
`likes.ts`, `media.ts` — never re-derived. This is what lets
`AtprotoSpacesContentRepository` (or `CreatorOwnedContentRepository`) be swapped
in without touching entitlement logic.

Media bytes are presigned browser↔storage transfers; the API never proxies
them. Storage keys are random, never derived from user input. `S3ObjectStorage`
is the real, only implementation (`forcePathStyle: true` for MinIO/R2/GCS
parity); `FakeObjectStorage` is test-only.

**Gated creator-owned PDS storage** (rearchitecture spec 1, PoC only,
`CREATOR_OWNED_GATED_CONTENT_ENABLED` — dev-only, refused under
`NODE_ENV=production`): a gated body is AES-256-GCM-encrypted per-post into
`fans.foryour.post.encryptedBody` with a `fans.foryour.accessPolicy` record, and
the envelope-wrapped key sits in `ContentKey`. `KeyGrantService` +
`POST /content-keys/grant` is the entitlement→key boundary — a key is returned
only for the creator or a currently-paid `ACTIVE` sufficient-tier subscription;
grants are revocable, 24-h expiry, recorded in `ContentKeyGrant`. With the flag
off (default) gated content stays Postgres-only and app-authoritative — plaintext
must never land on the permanently-archived firehose, and atproto Spaces
provides access control, not confidentiality.

---

## Diagram 4 — Future Spaces architecture (not built; runs dead last)

Spaces was extracted from the numbered plan to
[`prompts/atproto-spaces.md`](../prompts/atproto-spaces.md), which runs **after
this review**. Post-rearchitecture it is a **key-grant / permission transport**,
never a storage backend. The diagram reads as a grant path:

```
subscriber DID
     │  authenticated request for gated content
     ▼
apps/api  (foryour.fans stays the system of record for entitlement + payment)
     │  canAccess(subscriberDid, creatorDid, requiredTierId)  ← SOLE authority, unchanged
     ▼
Space Authority  (Spaces adapter behind the SAME ContentRepository / a SpaceAuthority seam)
     │  entitlement satisfied → issue a Space credential  (GRANT ONLY)
     ▼
creator Space  (on the creator's own PDS)
     │  credential admits a fetch of the ENCRYPTED blob; ciphertext never leaves the PDS
     ▼
subscriber  (decrypts locally with the granted per-post content key)
```

Invariants Spaces must not break: `canAccess` remains the only entitlement
authority; the ciphertext of gated content stays on the creator's PDS;
foryour.fans brokers the key grant but is not the store. Spaces becomes one
interchangeable backend, gated on `ATPROTO_SPACES_ENABLED` (default false), with
`AtprotoSpacesContentRepository` a throwing stub until that spec runs.

---

## Diagram 5 — Payments

```
subscriber ── POST /creators/:identifier/subscribe  { tierId }
     │  requireSession + requireCsrf + requireNotRestricted
     │  CreatorBlock check (banned-from-this-creator → 403)
     ▼
packages/subscriptions  subscribeToTier
     │  PaymentProvider.createSubscription(...)  ← abstraction, NOT Stripe-shaped
     │  Subscription row: status=PENDING,
     │    priceCentsAtSubscription / currencyAtSubscription  ← SNAPSHOT, never live tier price
     ▼
returns { redirectUrl }   (hosted-checkout model — no synchronous "active")
     │
     ▼
browser follows redirect → provider hosted checkout → back to /subscribe/return
     │
     ▼   (provider, asynchronously)
POST /webhooks/:provider   (own Fastify scope, RAW body preserved for signature verification,
     │                       no cookie, gated on provider === paymentProvider.name)
     ▼
packages/subscriptions  processWebhookEvent
     │  PaymentEvent [provider, providerEventId] UNIQUE  → idempotency ledger
     │    • row absent            → insert, process
     │    • row + processedAt set → "duplicate", short-circuit
     │    • row + processedAt null → prior crash, retry
     │  handleWebhook verifies signature (throws → rejected) BEFORE any side effect
     │  applySubscriptionSideEffect (statusForEventType, packages/subscriptions/src/webhooks.ts):
     │    • occurredAt < Subscription.lastWebhookEventAt → "stale", no transition
     │    • subscription.activated                     → ACTIVE
     │    • subscription.past_due  / payment.failed     → PAST_DUE  (canAccess denies non-ACTIVE — fails closed, no grace)
     │    • subscription.canceled  / payment.refunded   → CANCELED  (access ends with the money)
     ▼
Subscription.status → canAccess (ACTIVE only) → entitlement → subscriber unlocks content

Payout side (creator):
POST /creators/me/payout-account   (requireSession + requireCsrf +
     Creator.verificationStatus === "VERIFIED")   → PayoutProvider.createCreatorAccount
GET  /creators/me/payout-account/status           → PayoutProvider.getAccountStatus
   Payout status gates what the dashboard DISPLAYS, never what a creator may have/do.
```

The `PaymentProvider` / `PayoutProvider` interface is exactly
`createCustomer` / `createSubscription` / `cancelSubscription` / `handleWebhook`
and `createCreatorAccount` / `getAccountStatus` — no Stripe concept
(PaymentIntents, etc.) leaks into the domain. `createSubscription`'s
`redirectUrl` result shape is chosen for the hosted-checkout model most
adult-content-compatible processors actually use. **`FakePaymentProvider` /
`FakePayoutProvider` are the only implementations**, wired as the real ones per
the spec; `NODE_ENV=production` refuses to boot with `PAYMENT_PROVIDER=fake` or
`PAYOUT_PROVIDER=fake` (no break-glass), so no real money can move and
`/webhooks/fake` does not route in a production deployment at all — structurally,
not by a runtime check. A `NODE_ENV=development` deployment on a public URL (the
staging overlay, which exists to exercise hosted AT OAuth) *does* run the fake
provider; there, `ALLOW_FAKE_WEBHOOKS=false` (set in
`overlays/staging/api-env-config.yaml`) makes the unsigned `/webhooks/fake`
route return the same opaque `404` as an unknown provider, so a forged delivery
cannot drive `PENDING → ACTIVE`.

---

## Risk register

Likelihood/impact are for the system **as it would be at a real launch** (real
processor wired in, real deployment). ✅ mitigated · ⚠️ accepted trade-off ·
🔲 open, must close before that milestone.

### Security risks

| # | Risk | Status | Notes |
|---|---|---|---|
| S1 | Session-cookie forgery / theft | ✅ | 32-byte opaque token, server-side lookup, `HttpOnly` + `Secure` (prod) + `SameSite=Lax`; same-origin proxy so Lax works. No IP/UA binding — ⚠️ deliberate (breaks portable cross-device identity, weak signal). |
| S2 | Forged payment webhook grants free access | ✅ prod / ✅ deployed dev / ⚠️ local | `handleWebhook` signature check runs before any effect; `PAYMENT_PROVIDER=fake` can't boot under production, so `/webhooks/fake` doesn't route there. **The fake's signature check is a no-op**, so a deployed `NODE_ENV=development` env (staging) sets `ALLOW_FAKE_WEBHOOKS=false` → the route `404`s for the fake provider. Left reachable only on a local/CI dev box. A real processor integration MUST implement real verification (S9). |
| S3 | CSRF on a mutating route | ✅ | Double-submit `x-csrf-token` vs. server-side session store on every mutating authenticated route. |
| S4 | Cross-tenant data access (another creator's rows, another subscriber's content) | ✅ | Ownership by construction (`request.session!.did`, never a client id); `getOwned*` returns identical `404` for "absent" and "not yours"; `canAccess` tier-hierarchy check exercised in both directions by tests. |
| S5 | Locked-post body/media leaking to a non-entitled viewer | ✅ | `toLockedStub` and `toPostResponse` are separate functions; a locked stub cannot carry `text`/`media`. `/media/:id/access` re-checks per-post entitlement live, 60-s URLs. |
| S6 | Privilege escalation to admin | ✅ | `ADMIN_DIDS` env var is the only path, applied idempotently at login; `requireAdmin` re-reads `User.role` from Postgres every call. No self-service route exists. |
| S7 | Restricted user routing around moderation | ✅ | `requireNotRestricted` on every harm-capable write (comment, like, subscribe, report, block, creator-block — the last added in the Phase 15 audit); fresh `User.status` read each call. |
| S8 | Stack-trace / internal-detail disclosure | ✅ | Error handler returns generic 500s; `/ready` failure reason is a fixed string; storage keys random. |
| S9 | **Real payment processor integration ships without real signature verification / PCI review** | 🔲 | Blocked on the processor choice. The code path that would verify exists and is exercised; only the concrete impl is a placeholder. Its own security review is required before real money. |
| S10 | `/metrics` is unauthenticated at the app layer | ⚠️ | Intended: restrict at network/ingress, the conventional Prometheus pattern. Documented in `metrics.ts`. |
| S11 | Rate limiting is per-IP (`x-forwarded-for`), not per-account | ⚠️ | Distributed flooding across IPs can exceed an effective per-account rate. Easy to add later behind the same `keyGenerator`; deferred because most routes don't resolve a session before the limit check. |
| S12 | Webhooks share the global rate-limit budget (no dedicated lower one) | ⚠️ | A real provider's traffic profile/IP ranges are unknown until one is chosen; a guess would be worse. Revisit with S9. |
| S13 | Trusting `x-forwarded-for` for rate-limit keys | ⚠️ | Assumes the reverse proxy strips spoofed headers (a deployment-level control). `trustProxy` intentionally not set on Fastify. |
| S14 | No CAPTCHA / bot detection on login-start, report, comment | ⚠️ | Not requested by the spec; inventing one risks colliding with an unmade UX decision. Login-start has the strict 10/min route limit. |
| S15 | AES-GCM gated-content encryption / key-wrapping design (creator-owned PDS) | ⚠️ Experimental | PoC only, dev-flag-gated, refused in production, **paused for privacy review**. Not on any launch path. |

### Scaling risks

| # | Risk | Status | Notes |
|---|---|---|---|
| Sc1 | `GET /feed` over-fetch (`limit + 20`, filter, slice) can under-return | ⚠️ | Documented. Not real cursor pagination — a `canAccess` filter can shrink a page. The fully-correct fix is a fetch-until-full loop; Phase 9's own text doesn't ask for cursor pagination on the home feed. Per-creator feed (`GET /creators/:id/feed`) **does** have deterministic compound cursor pagination. |
| Sc2 | `ingest.ts` is single-instance by design | ✅ / 🔲 ops | Correct shape (N replicas racing the same firehose is wrong). Has its own k8s Deployment (`api-ingest-deployment.yaml`, always 1 replica) as of Phase 16 — but no leader-election / failover; a crash pauses ingestion until the pod restarts (cursor is resumable, so no data loss, only lag). |
| Sc3 | Discovery index grows unbounded with network-wide `fans.foryour.*` traffic | ⚠️ | Near-zero real traffic today. `INDEX_BSKY_POSTS` (whole-firehose `app.bsky.feed.post`) is default-off precisely because `wantedCollections` can't scope to a DID set. A `wantedDids` subscription is the documented future lever. |
| Sc4 | Dashboard time-series recomputed per request from raw `Subscription` rows | ⚠️ | No new models (per spec). `@@index([creatorId])` added in Phase 15. Fine at MVP scale; a materialized daily rollup is the scale answer. |
| Sc5 | Rate-limit / session / OAuth-state all on one Redis | ⚠️ ops | Standard; size/replicate Redis accordingly. `/ready` now checks Redis so a bad Redis fails readiness rather than silently degrading. |
| Sc6 | `overlays/production` intentionally crash-loops today | ✅ by design | `NODE_ENV=production` + `PAYMENT_PROVIDER=fake` guard. Becomes deployable the day a real provider lands and the env enum grows — one ConfigMap value. |
| Sc7 | Media processing is synchronous `PassthroughMediaProcessor` in the `/complete` request | ⚠️ | Real transcoding/scanning must move to a job queue (BullMQ is already the sanctioned tool). The `MediaProcessor` interface + `PENDING_UPLOAD→PROCESSING→READY|REJECTED` state machine already accommodate it with no schema change. |

### AT Protocol compatibility risks

| # | Risk | Status | Notes |
|---|---|---|---|
| A1 | Jetstream wire format drift (v1 flat vs. doc-described v2) | ✅ | Built against the **verified-live** v1 shape and `wantedCollections` param, not the docs (which were wrong). `bskyPost.test.ts` / `jetstreamTypes.ts` pin it. Re-verify on any Jetstream major change. |
| A2 | Hand-written `app.bsky.feed.post` / `app.bsky.graph.block` builders drift from the real lexicons | ✅ | Vendored lexicon JSON (`packages/lexicons/vendor/app/bsky/**`, `SOURCES.md`) + agreement tests. Chosen over `lex install` codegen to avoid a network dependency and the transitive-ref closure. Refresh the vendored JSON periodically. |
| A3 | Deleting an already-absent AT record's behavior on a real PDS is unverified | ⚠️ | Guarded defensively (`deactivateTier`/`reactivateTier` check state before calling delete; `deleteRecord`'s doc comment flags it). Low impact. |
| A4 | The app cannot force-delete a user's public record from the open network | ⚠️ inherent | A protocol property, not a bug. Deletes are authorized-write / best-effort-propagation. Tombstones are handled on ingest. |
| A5 | `identity` firehose events not consumed → stale indexed handles between commits | ⚠️ | Documented trade-off (unbounded bandwidth to catch a tiny relevant fraction). Handles refresh opportunistically on any commit for that DID. |
| A6 | `com.atproto.label.defs` is a live-fetched, CID-pinned dependency | ✅ | Vendored + pinned like any dependency; `pnpm build` never re-fetches. |
| A7 | Custom-record → Bluesky-record link is one-way (no backlink on `app.bsky.feed.post`) | ⚠️ by decision | No non-degrading place for a `fans.foryour.post` ref in a normal Bluesky post (`docs/bluesky-public-posts.md` §4). Merge/dedupe in `packages/discovery` handles the pairing. |

### Data portability limitations

| # | Limitation | Notes |
|---|---|---|
| P1 | Gated (`SUBSCRIBERS`/`TIER`) content is **not portable today** | Postgres-only, app-authoritative. The creator-owned-PDS PoC (encrypted records on the creator's own PDS + `rebuildFromPds`) is the portability answer, but it is **paused for privacy review** and not on any launch path. This is the single biggest gap between the product as built and the "creator owns their data" thesis. |
| P2 | Private media bytes live only in app S3 | By design for now; `fans.foryour.media` blob path + the `packages/media` upload rewrite is a creator-owned-PDS implementation-phase item. |
| P3 | Comments, likes, subscriptions, billing, moderation history | Inherently app-private (per `docs/atproto-vs-database.md`); no portable representation is intended. Bluesky-native representations of Phase 12 interactions on dual-published posts are an explicitly-open question, not decided. |
| P4 | Public data **is** portable | Profile/tier/public-post records live in the user's own repo; `GET /creators/me/portability` reports DID, PDS URL, collections, last sync, `exportImportNeededToMove: false`. |
| P5 | Discovery index is a derived read model | Not a system of record; rebuildable from the firehose. Not a portability concern. |

### Payment-provider coupling

| # | Point of coupling | Assessment |
|---|---|---|
| C1 | `PaymentProvider` / `PayoutProvider` interface | **Low.** Spec-shaped, no processor-specific concept in the domain. Hosted-checkout `redirectUrl` result assumed. |
| C2 | Webhook route preserves the raw request body | **Good.** Signature verification over exact received bytes is possible for whatever provider lands. |
| C3 | Webhook event vocabulary (`subscription.activated`/`.past_due`/`.canceled`, `payment.failed`/`.refunded`, `occurredAt` ordering) | **Medium.** A mapping layer in the real provider's `handleWebhook` translates its event names to these; the domain only knows the internal set. New event types = new `statusForEventType` cases, not a schema change. |
| C4 | `Subscription.provider` / `providerSubscriptionId` / `PaymentEvent.provider` | **Low.** Already multi-provider-shaped; `provider` is a column, not an assumption. |
| C5 | Currency handling | **Medium (product, not coupling).** Best-effort modal currency on the dashboard; genuine multi-currency creators get a wrong aggregate. Documented; no conversion layer invented. |
| C6 | Payout status → dashboard display gating | **Low.** Client-side (`PayoutGate`); the API always returns real numbers. Consistent with "payout gates what you *see about earnings*, not what you may *do*." |

**Net:** swapping `FakePaymentProvider` for a real adult-content-compatible
processor is a `packages/subscriptions/providers/` addition plus an env-enum
entry plus that provider's own webhook-name mapping — no domain, route, or
schema change. The abstraction did its job.

### Features that could become separate services later

| Candidate | Trigger to split | Notes |
|---|---|---|
| `apps/api/src/ingest.ts` (Jetstream consumer) | Already a separate process; split to its own deployable when it needs independent scaling/release cadence or a work queue in front of the indexer. | Lowest-friction split — separate entrypoint, shared package, its own k8s Deployment already. |
| Media processing (`MediaProcessor`) | The day real transcoding/virus/moderation scanning lands — it must not run inside the `/complete` request. | Job queue (BullMQ) + worker; interface + state machine already fit. |
| Webhook post-processing | High webhook volume from a real processor, or long-running side effects. | `PaymentEvent` ledger already makes this safely retryable/idempotent off a queue. |
| Discovery / AppView (`GET /discover`,`/search` + index) | If the index becomes network-scale or serves other clients, or if a real labeler service is stood up. | Read-only, DID-keyed, already isolated in `packages/discovery`; never touches entitlement. |
| A real labeler service (`com.atproto.label.subscribeLabels` over `ContentLabel`) | Compliance / ecosystem need to publish labels to other AT apps. | Row shape already matches the wire format; only the service is unbuilt. |
| Notifications (email/push) | Pre-real-money launch (receipts, payment-failure, moderation notices) — currently out of scope platform-wide. | Greenfield; no interface exists yet. |

---

## MVP-readiness classification

### Ready for MVP

- **AT Protocol OAuth identity** — DID-canonical, PKCE + DPoP, no passwords, loopback refused in prod, handle-change redirects. Live-verified against real PDSes.
- **Custom lexicons** (`fans.foryour.profile`/`post`/`tier`) — authored, validated, NSIDs compile-time-pinned; `com.atproto.label.defs` vendored + CID-pinned.
- **Creator accounts & public profiles** — AT-record-first ordering, write-through cache, handle/DID addressing, no slug.
- **Subscription tiers** — integer minor units, explicit currency, deactivate-not-delete, price grandfathering via `priceCentsAtSubscription` snapshot, public metadata synced to AT.
- **Subscription/entitlement engine** — `canAccess` (ACTIVE-only, tier-hierarchy), single choke point, exercised in both directions by tests.
- **Webhook processing** — idempotency ledger, out-of-order rejection, failed-payment/refund handling, raw-body preserved for signature verification.
- **Private content** — `ContentRepository` storage/entitlement split, PUBLIC-only AT mirroring at one choke point, locked stubs that structurally can't leak.
- **Secure media** — presigned browser↔storage, random keys, 60-s download URLs re-checked live, `READY`-only gate, per-post entitlement (not "any subscriber").
- **Feeds** — home feed + per-creator feed (real cursor pagination on the latter), locked stubs with safe metadata only.
- **Public discovery** — Jetstream ingestion against the verified-live wire format, create/update/delete handling, DID-keyed network-wide index, never consulted for entitlement.
- **Comments & likes** — access inherited from the parent post via one shared helper, Postgres-only, likes idempotent by construction.
- **Creator dashboard** — ownership by construction, billing numbers from the billing DB (never AT), price-snapshot revenue, date filters where meaningful.
- **Trust & safety foundation** — `Report`/`ModerationCase`/`ContentLabel`/`UserBlock` (real `app.bsky.graph.block`)/`CreatorBlock`/`AuditLog` (append-only by convention), admin console API fully `requireAdmin`-gated, pluggable `ContentClassifier` hook, `verificationStatus` gate on adult-content flags and payout onboarding.
- **Production hardening** — helmet, Redis-backed rate limiting, explicit body limit, `/metrics`, Redis-aware `/ready`, `ErrorReporter` seam, DB indexes/constraints/FKs, production boot guards with no break-glass.
- **Kubernetes deployment** — `base/` + dev/staging/production overlays, all `kustomize`-verified; external Postgres/Redis/S3; two Dockerfiles with a verified-booting runtime; per-request CSP nonce on the web tier.
- **Web client** — see `docs/ux-review.md`; classified there.

### Needs work before MVP (pre-real-money)

- **A real payment/payout processor** — adult-content-compatible; a business decision, unmade. Until then no real money moves and `overlays/production` cannot boot. Blocks C1/S2/S9.
- **Real webhook signature verification** in that processor's `handleWebhook` — the code path exists and is exercised; the concrete implementation is a no-op fake.
- **A processor security / PCI-scope review** once one is chosen.
- **Subscriber age verification** — `containsAdultContent` exists as a classification field; there is no age gate, jurisdictional consent record, or `User`-side workflow. Legal/compliance decision + vendor.
- **A real KYC vendor** behind `submitVerification`/`approve`/`reject` — the workflow shell and gate are real; no identity document is collected.
- **Transactional notifications** — receipts, payment-failure, refund, moderation notices. Out of scope for every phase in `prompts/full.md`; explicitly required before real-money launch.
- **Admin queue for pending creator verifications** — `approve`/`reject` exist but no `GET` lists creators by `verificationStatus` and a submission opens no `ModerationCase`; an admin needs the creator id from elsewhere.
- **Edge/DDoS layer** (CDN / LB DDoS protection) — application-layer rate limiting is basic-tier only; S11–S13.
- **`ingest.ts` failover** — single instance with no leader election; a crash pauses (does not lose) ingestion.
- **A real screen-reader pass** of the core flows — `docs/web-accessibility.md` covers linting + axe + architectural review, not a live SR pass.
- **Lighthouse run** against `/`, `/c/:handle`, `/feed` in an environment that has it.
- **First real `docker build` + `kubectl apply`** against a live cluster — Dockerfile logic and every overlay were verified by host-level reproduction and `kustomize build`, but no end-to-end image build/deploy ran (no registry access in the build environment).

### Future work

- Real media processing pipeline (transcoding, thumbnails, virus + moderation scanning) on a job queue behind the existing `MediaProcessor` hook.
- Cursor pagination for `GET /feed` (fetch-until-full loop).
- A `Follow` model (the home feed currently reads "all PUBLIC" for the discovery half — a faithful reading, would only narrow).
- `identity`-firehose-driven / `wantedDids`-scoped handle currency in the index.
- Materialized dashboard rollups; true event-sourced subscription-status history.
- Multi-currency support with a conversion layer.
- A real network-registered labeler service exposing `ContentLabel` rows (`com.atproto.label.subscribeLabels`).
- `UserBlock`/`CreatorBlock` extended to feeds/discovery/likes if a concrete product need appears.
- Ingesting other accounts' `app.bsky.graph.block` records from the network.
- Public-post **media bytes** to the creator's PDS (`fans.foryour.media` blob path).
- Making dual-published Bluesky public posts the unconditional default.
- Rich-text / markdown post bodies; draft state.
- Appeals workflow for moderation actions (currently a placeholder link).
- Per-account rate limiting; a dedicated webhook rate-limit budget.

### Experimental

- **Creator-owned PDS storage** (`prompts/creator-owned-pds.md`) — backend PoC in the tree, both flags (`CREATOR_OWNED_PDS_ENABLED`, `CREATOR_OWNED_GATED_CONTENT_ENABLED`) **default off**, gated content refused under `NODE_ENV=production`, **paused for privacy review**. The portability thesis for gated content depends on this landing safely.
- **Bluesky-compatible dual-published public posts** (`prompts/bluesky-public-posts.md`) — **implemented**, still flag-gated behind `CREATOR_OWNED_PDS_ENABLED`; only default-on change is additive nullable linkage fields on API responses.
- **AT Protocol Spaces** (`prompts/atproto-spaces.md`) — not built; `AtprotoSpacesContentRepository` is a throwing stub, never constructed. `ATPROTO_SPACES_ENABLED` is the guard name that spec will introduce (default false) — it is not yet a real entry in `config/env.ts` or `.env.example`, only referenced in code comments. Runs **dead last**, and only ever as a key-grant / permission transport over encrypted creator-owned storage — never the private-content storage backend.

---

## Bottom line

The system is a **coherent, well-bounded MVP for everything that does not
involve moving real money or meeting adult-content compliance obligations.** The
domain boundaries hold, the entitlement authority is singular, the
AT-vs-Postgres data rules are enforced at choke points rather than scattered,
and the abstractions around external systems (payment, payout, storage, media
processing, classifiers, error reporting) are real seams that a concrete
implementation drops into without touching domain code.

The gap between "runs" and "can launch for real" is **exactly** the set of
deliberately-deferred business and compliance decisions: a real processor and
its security review, subscriber age verification, a KYC vendor, transactional
notifications, and an edge protection layer. None of these is an architectural
flaw; each is a decision the build plan intentionally left for a human to make.
The creator-owned-PDS portability story for gated content is the one place where
the product as built (app-authoritative Postgres) trails the project's stated
thesis — and that work exists, flag-gated, awaiting a privacy review.

No feature changes were made in this phase.
