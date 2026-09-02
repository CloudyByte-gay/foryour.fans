# Codex Build Plan — AT Protocol Paid Creator Platform

We are building an AT Protocol-native paid creator platform inspired by Patreon/OnlyFans.

The application should use AT Protocol for portable identity, public creator data, public posts, social/discovery integration, and eventually permissioned content through AT Protocol Spaces.

For the initial production architecture, private paid content MUST NOT depend on AT Protocol Spaces because Spaces is currently experimental. Private content should initially use application-controlled storage behind an interface that can later be replaced or supplemented by a Spaces-backed implementation.

The experimental AT Protocol Spaces work has been **extracted** from this file into [`prompts/atproto-spaces.md`](./atproto-spaces.md) so the main build sequence has no experimental detour. `PHASE 11` below is now a vacant slot (kept, not renumbered, so every `Phase 12`–`Phase 17` reference still resolves); build `PHASE 12`–`PHASE 17` straight after `PHASE 10`.

Two refactor/rearchitecture phases run after `PHASE 10` and before `PHASE 12` (slot 11 is vacant), in this confirmed order: [`prompts/creator-owned-pds.md`](./creator-owned-pds.md), then [`prompts/bluesky-public-posts.md`](./bluesky-public-posts.md). They supersede "application-controlled storage as the durable store" above — creator content, media, and config move to the creator's own PDS (gated content encrypted, with foryour.fans brokering entitlement and decryption-key grants), and every `PUBLIC` post is dual-published as `app.bsky.feed.post` + `fans.foryour.post`. `PHASE 12`–`PHASE 17` then assume both have landed. Finally, [`prompts/atproto-spaces.md`](./atproto-spaces.md) runs **dead last**, adding Spaces as a key-grant/permission transport over that encrypted creator-owned storage — never the private-content storage backend.

Full order: `PHASE 1`–`10` (done) → `creator-owned-pds.md` → `bluesky-public-posts.md` → `PHASE 12`–`17` → `atproto-spaces.md`. See `docs/build-plan.md` → "Planned rearchitecture".

**Status:** both rearchitecture specs have run — `creator-owned-pds.md` (backend PoC, flag-gated behind `CREATOR_OWNED_PDS_ENABLED`, paused for privacy review) and `bluesky-public-posts.md` (implemented, still flag-gated). `PHASE 12`–`17` must now assume: every `PUBLIC` post is (or will be) dual-published as `app.bsky.feed.post` + `fans.foryour.post`, linked one-way via `fans.foryour.post.bskyUri`; API post responses carry `foryourAt*`/`bskyAt*`/`canonicalUri`/`sourceCollections`; `PATCH /creators/me/posts/:id` exists; `GET /posts/:id` resolves AT-URI ids; `packages/discovery` has `mergeIndexedPosts`. Bluesky-native representations of Phase 12 interactions (`app.bsky.feed.like`/reply) on a dual-published post are an open question for that phase, not decided here. Media bytes on public posts are still deferred to the creator-owned-PDS implementation phase.

## Hosting model

This application does NOT operate its own AT Protocol PDS (Personal Data Server). Users bring their own AT Protocol identity, hosted on any PDS (e.g. `bsky.social` or a self-hosted/custom PDS). Public AT records (profile, public posts, tier metadata) are written into the AUTHENTICATED USER'S OWN repo, via their own PDS, using the write scope granted during OAuth — never into a repo the application controls.

This has consequences that must hold throughout every phase:

- The application cannot unilaterally delete or edit a user's public AT record; it can only issue authorized writes/deletes through that user's own OAuth session, or ask the user to do so.
- Because public AT records are replicated across the open AT network (relays, AppViews, other apps) once published, deletion/moderation of public content is best-effort propagation, not guaranteed removal. Tombstone/deletion events must be handled explicitly wherever the app indexes public content (see Phase 10).
- Public media (avatars, banners, public post attachments) is uploaded as blobs to the user's OWN PDS via `com.atproto.repo.uploadBlob`, subject to that PDS's blob size limits. This is architecturally distinct from PRIVATE paid media, which lives in application-controlled S3-compatible storage (Phase 8) and is never written to any PDS.

## Content policy

This platform is explicitly intended to support adult/NSFW creator content, not only general-audience content. This has concrete architectural consequences called out in the relevant phases:

- Do not assume a mainstream processor like Stripe will be usable for all creators/content — many general-purpose processors prohibit adult content. The `PaymentProvider`/`PayoutProvider` abstraction (Phase 6) exists specifically so a high-risk/adult-compatible processor can be substituted without touching domain code.
- Age verification and creator identity/KYC verification are elevated from "future work" to a pre-launch (pre-real-money) requirement — see Phase 14. Do not invent the specific legal requirements; document where legal/compliance review is required before enabling real payouts.

## Core product idea

Users authenticate with an AT Protocol identity.

Creators can:

- create a creator profile
- define paid subscription tiers
- publish public posts
- publish subscriber-only posts
- upload images/video
- receive subscriptions
- manage subscribers

Subscribers can:

- authenticate using AT Protocol
- discover creators
- view public creator profiles
- subscribe to creators
- access content allowed by their subscription tier
- cancel subscriptions
- view their active subscriptions

AT Protocol identity is the canonical user identity.

Use the DID as the primary external identity identifier.

Example:

```text
did:plc:abc123
```

Do not create a parallel username/password authentication system.

Do not create a parallel **username / slug / vanity-handle** system either. The
AT Protocol handle is the public identity for every user (creator and
subscriber); the DID is the durable internal key. A creator's page is
`/c/<handle>` (and `/c/<did>`, which never breaks). See
[`prompts/handle-identity.md`](./handle-identity.md) — a refactor phase run
after PHASE 7 that removes the `Creator.slug` PHASE 4 introduced and adds
handle-change redirects. Phases from PHASE 8 on assume no slug exists.

## Technical preferences

Use:

- TypeScript
- Node.js
- Fastify
- PostgreSQL
- Prisma
- Redis where useful
- AT Protocol TypeScript SDK
- Next.js for the web frontend
- S3-compatible object storage for private media
- Docker
- Kubernetes-compatible deployment
- OpenAPI where appropriate

Prefer:

- strong domain boundaries
- dependency injection where useful
- interfaces around external systems
- migrations
- unit tests
- integration tests
- typed environment configuration
- structured logging
- explicit authorization checks
- idempotent webhook handling
- background jobs only where warranted
- cursor-based pagination on every list endpoint (do not ship offset pagination that will need a breaking change later)

Use Redis for concrete purposes only, introduced when the phase actually needs them — do not stand up unused infrastructure:

- server-side session/cache lookups (Phase 2)
- rate limiting counters (Phase 15)
- a background job queue (e.g. BullMQ) for webhook post-processing and AT network ingestion (Phases 6, 10)

Avoid unnecessary microservices initially.

Build this as a modular monolith unless a boundary clearly benefits from becoming a separate service.

Target repository structure:

```text
/
├── apps/
│   ├── web/
│   └── api/
├── packages/
│   ├── atproto/
│   ├── database/
│   ├── auth/
│   ├── subscriptions/
│   ├── content/
│   ├── media/
│   ├── lexicons/
│   └── shared/
├── infrastructure/
│   ├── docker/
│   └── kubernetes/
├── docs/
└── package.json
```

Use a workspace package manager such as pnpm.

Do not implement functionality from later phases unless required to make the current phase work.

At the end of every phase:

1. run tests
2. run linting
3. run type checking
4. verify the application starts
5. update README.md
6. create or update docs/architecture.md
7. summarize files changed
8. document known limitations
9. identify the exact next phase

Do not silently mock important security behavior.

---

# PHASE 1 — Repository Foundation

Build the repository foundation only.

Create a pnpm TypeScript monorepo containing:

```text
apps/api
apps/web

packages/database
packages/shared
packages/atproto
packages/auth
packages/content
packages/subscriptions
packages/media
packages/lexicons
```

## API

Create a Fastify API.

Implement:

```text
GET /health
GET /ready
```

Health should verify the application process.

Ready should verify PostgreSQL connectivity.

Add:

- structured logging
- configuration validation
- graceful shutdown
- error handler
- request IDs
- CORS configuration
- environment variable validation

## Database

Configure Prisma with PostgreSQL.

Create an initial User model:

```text
User

id            UUID
did           String UNIQUE
handle        String?
displayName   String?
createdAt
updatedAt
```

The DID is the canonical identity.

Never use the mutable AT handle as the primary identity.

## Local development

Create Docker Compose for:

- PostgreSQL
- Redis
- MinIO or another S3-compatible development object store

Provide `.env.example`.

## Web

Create a basic Next.js application.

Pages:

```text
/
 /login
 /dashboard
```

No real authentication yet.

The homepage should explain that this is an AT Protocol-native paid creator network.

## Testing

Add basic API tests for:

```text
/health
/ready
```

## CI

Add a GitHub Actions workflow that runs on every pull request: install, lint, type check, test, build. This is the automated enforcement of the "run tests / lint / type check" step required at the end of every later phase — do not rely on that step being done manually.

Do not implement subscriptions, payment processing, feeds, media uploads, or AT login yet.

Stop after Phase 1 is complete.

---

# PHASE 2 — AT Protocol Identity and OAuth

Implement AT Protocol authentication.

Before writing code, inspect the current official AT Protocol OAuth documentation and current TypeScript SDK APIs. Do not rely on old examples if the SDK has changed.

Users should authenticate using an AT Protocol handle such as:

```text
alice.bsky.social
```

or a custom-domain handle.

Resolve:

```text
handle
→ DID
→ PDS
```

Use AT Protocol OAuth.

Do NOT request or store Bluesky app passwords.

## Authentication flow

Frontend:

```text
/login
```

User enters their AT handle.

Backend starts OAuth.

After successful authorization:

1. resolve the DID
2. store/update the User
3. establish an application session
4. redirect to `/dashboard`

Store:

```text
did
current handle
display name if available
avatar URL if available
```

Treat handles and profile information as mutable cached data.

Treat DID as immutable identity.

## Session architecture

Use secure server-side sessions.

Requirements:

- HTTP-only cookies
- secure cookies in production
- CSRF protection where appropriate
- session expiration
- logout
- OAuth state validation
- PKCE where required
- DPoP where required by AT OAuth

Routes:

```text
POST /auth/atproto/start
GET  /auth/atproto/callback
POST /auth/logout
GET  /me
```

Frontend should show:

```text
Continue with AT Protocol
```

After login show:

- handle
- DID
- avatar if available

Add tests covering identity creation and returning-user login.

Do not implement creators or subscriptions yet.

Stop after Phase 2.

---

# PHASE 3 — Custom AT Protocol Lexicons

Create our application's Lexicon namespace.

**Update (production domain selected):** the production domain is `foryour.fans`. Per AT Protocol's reverse-DNS NSID convention (e.g. `bsky.app` → `app.bsky.*`), the Lexicon namespace is:

```text
fans.foryour
```

This was originally specced as a placeholder (`dev.creator`, swappable "until the final production domain is selected") — since no record was ever published under that placeholder before the domain was chosen, the rename to `fans.foryour` was a same-day, zero-migration change: new lexicon JSON authored under the real NSID, `pnpm generate` re-run, done. See `packages/lexicons/src/nsids.ts` for the centralized constants and why they're compile-time, not a live env-var read.

Create Lexicons corresponding conceptually to:

```text
fans.foryour.profile
fans.foryour.post
fans.foryour.tier
```

Before implementing these, inspect current official Lexicon documentation.

## Creator profile

Create an AT record representing public creator information.

Possible fields:

```text
displayName
bio
avatar
banner
website
createdAt
```

## Subscription tier metadata

Public tier metadata may include:

```text
name
description
monthlyPrice
currency
sortOrder
```

Do NOT put:

- customer payment IDs
- billing history
- subscriber lists
- legal names
- tax information
- payout information

into public AT records.

## Public post

Define:

```text
text
createdAt
media references
content labels if applicable
```

Keep public records intentionally public.

`avatar`, `banner`, and public post media reference blobs uploaded to the AUTHENTICATED CREATOR'S OWN PDS (see "Hosting model" above), not to application-controlled storage. Enforce the target PDS's blob size limits client-side before upload.

Generate TypeScript types from the Lexicons where supported.

Create validation tests.

Record the Lexicon NSID + version alongside the namespace configuration — done: see `packages/lexicons/src/nsids.ts`.

Document which information lives:

```text
AT Protocol
```

versus:

```text
our private database
```

Do not build paid content yet.

Stop after Phase 3.

---

# PHASE 4 — Creator Accounts

> **Partly superseded by [`prompts/handle-identity.md`](./handle-identity.md)**, run after PHASE 7.
> The `Creator.slug` field, slug validation, the reserved-word list and the
> slug-change flow described in this phase were **removed** by that refactor —
> the public creator identifier is the AT handle or DID only, and `/c/<handle>`
> replaces `/c/:slug`. Everything else in this phase still stands.

Implement creator functionality.

A normal authenticated user can become a creator.

Database:

```text
Creator

id
userId
did UNIQUE
slug UNIQUE
status
createdAt
updatedAt
```

Create:

```text
CreatorProfile
```

if private/application-specific profile metadata is needed.

Routes:

```text
POST /creators
GET  /creators/:identifier
PATCH /creators/me
GET  /creators/me
```

Slugs must be validated (e.g. lowercase alphanumeric + hyphen, length-bounded) and checked against a reserved-word list (e.g. `api`, `admin`, `login`, `c`, `discover`). Treat slug changes as rare/rate-limited administrative actions, not a routine profile edit — a slug change breaks existing external links (`/c/:slug`), so old links should resolve via DID lookup rather than 404ing outright where practical.

The public creator identifier should support either:

```text
handle
slug
DID
```

without relying on a mutable handle internally.

Frontend:

```text
/become-a-creator
/creator/settings
/c/:slug
```

Publishing or updating a creator profile should update the appropriate AT record where appropriate.

Add ownership authorization checks.

A user must never be able to modify another creator's account.

Stop after Phase 4.

---

# PHASE 5 — Subscription Tiers

Implement creator subscription tiers.

Database:

```text
SubscriptionTier

id
creatorId
name
description
priceCents
currency
sortOrder
isActive
createdAt
updatedAt
```

Requirements:

- multiple tiers per creator
- prices stored as integer minor units
- currency explicitly stored
- tier can be deactivated
- existing subscriptions must retain historical tier information
- changing a tier's price must NOT retroactively change what existing subscribers are billed; the price a subscriber agreed to is snapshotted onto the `Subscription` record at subscribe time (see Phase 6), and `SubscriptionTier.priceCents` only affects new subscriptions

Routes:

```text
POST   /creators/me/tiers
GET    /creators/:creator/tiers
PATCH  /creators/me/tiers/:tierId
DELETE /creators/me/tiers/:tierId
```

Deleting should generally deactivate rather than destroy historical records.

Synchronize safe public tier metadata to the AT Protocol tier Lexicon.

Do NOT implement payment processing yet.

Stop after Phase 5.

---

# PHASE 6 — Subscription and Payment Abstraction

Build subscription billing behind an abstraction.

IMPORTANT:

Do NOT assume Stripe is appropriate for all platform content. This platform is intended to support adult/NSFW creators, and mainstream processors including Stripe commonly prohibit that content category in their terms of service. The fake/local `PaymentProvider` built in this phase is sufficient for development, but do not let its shape implicitly assume Stripe's specific API surface (e.g. Stripe-only concepts like PaymentIntents leaking into the domain interface) — a later real implementation may be a high-risk/adult-compatible processor with a different integration model (hosted checkout redirect, different webhook shapes, different customer/subscription lifecycle). Document this constraint in docs/architecture.md rather than picking a real processor now.

Build:

```ts
interface PaymentProvider {
  createCustomer(...)
  createSubscription(...)
  cancelSubscription(...)
  handleWebhook(...)
}
```

and:

```ts
interface PayoutProvider {
  createCreatorAccount(...)
  getAccountStatus(...)
}
```

The domain must not be tightly coupled to a specific processor.

Create database models:

```text
Subscription

id
subscriberUserId
creatorId
tierId
status

provider
providerSubscriptionId

priceCentsAtSubscription
currencyAtSubscription

currentPeriodStart
currentPeriodEnd
cancelAtPeriodEnd

createdAt
updatedAt
```

`priceCentsAtSubscription`/`currencyAtSubscription` snapshot the tier's price at the moment of subscribing, per the grandfathering requirement in Phase 5 — `canAccess` and revenue reporting (Phase 13) must use this snapshot, not the live `SubscriptionTier.priceCents`, which may have changed since.

Create:

```text
PaymentEvent

id
provider
providerEventId UNIQUE
type
payload
processedAt
createdAt
```

Webhook processing MUST be idempotent.

Subscription states should include at least:

```text
pending
active
past_due
canceled
expired
```

Add:

```text
Entitlement
```

or create a domain service capable of answering:

```ts
canAccess(
  subscriberDid,
  creatorDid,
  requiredTier
)
```

Do not yet build private posts.

Use a fake/local PaymentProvider implementation for development and automated tests.

## Creator payout onboarding

`PayoutProvider` must be wired to an actual flow, not just defined — a creator cannot receive money without one. Add:

```text
POST /creators/me/payout-account
GET  /creators/me/payout-account/status
```

`POST` calls `PayoutProvider.createCreatorAccount(...)` and returns whatever the provider needs the creator to complete onboarding (e.g. a redirect URL for a hosted onboarding flow). `GET` calls `getAccountStatus(...)`. A creator whose payout account is not yet verified should still be able to publish posts and receive subscriptions in `pending`-equivalent state, but the application should surface payout status clearly and this status gates whether the creator dashboard (Phase 13) shows real payout numbers.

Use a fake/local `PayoutProvider` implementation for development and automated tests, matching the `PaymentProvider` approach above.

Stop after Phase 6.

---

# PHASE 7 — Private Content Architecture

Implement the paid-content subsystem.

This is a critical architectural requirement.

Create:

```ts
interface ContentRepository {
  createPost(...)
  updatePost(...)
  deletePost(...)
  getPost(...)
  getCreatorFeed(...)
}
```

Implement:

```text
PrivateContentRepository
```

using PostgreSQL plus S3-compatible private object storage.

Also define, but DO NOT make production-dependent:

```text
AtprotoSpacesContentRepository
```

The Spaces version can initially be experimental or incomplete. It stays a stub until [`prompts/atproto-spaces.md`](./atproto-spaces.md), the extracted experimental phase that runs dead last.

The rest of the application must not care which implementation stores content.

## Private post model

Create:

```text
Post

id
creatorId

visibility

minimumTierId?
text

createdAt
updatedAt
deletedAt?
```

Create a `PostMedia` join table (`postId`, `mediaAssetId`, `sortOrder`) rather than an array column — `MediaAsset` (Phase 8) is uploaded independently of the post it ends up attached to (upload-then-attach), and a single asset should not be assumed to belong to exactly one post forever.

Visibility:

```text
PUBLIC
SUBSCRIBERS
TIER
```

Public AT posts and private application posts should have explicitly different storage behavior.

Never accidentally publish subscriber-only content into a normal public AT repository.

Routes:

```text
POST /creators/me/posts
GET  /creators/:creator/posts
GET  /posts/:id
DELETE /creators/me/posts/:id
```

Every private-content request must go through the entitlement service.

Add tests proving:

- anonymous user cannot access paid content
- nonsubscriber cannot access paid content
- valid subscriber can access it
- lower-tier subscriber cannot access higher-tier content
- creator can access own content

Stop after Phase 7.

---

# PHASE 8 — Secure Media

Implement image/video storage.

Use private S3-compatible storage.

Never make subscriber media objects globally public.

Architecture:

```text
browser
   ↓
authorized upload request
   ↓
short-lived presigned upload URL
   ↓
private object storage
```

Reading:

```text
browser
   ↓
GET /media/:id/access
   ↓
entitlement service
   ↓
short-lived signed URL
```

Database:

```text
MediaAsset

id
creatorId
storageKey
mimeType
size
width?
height?
duration?
status
createdAt
```

`status` should include at least `pending_upload`, `processing`, `ready`, `rejected`. The `GET /media/:id/access` flow (below) must only ever issue a signed URL for assets in `ready` status — this is the hook future moderation/virus scanning (Phase 14) plugs into without a schema change: scanning happens between `processing` and `ready`, and a `rejected` asset never becomes accessible regardless of entitlement.

Add validation for:

- MIME types
- maximum file size
- upload ownership

Design the media processing interface to support future:

- transcoding
- thumbnails
- virus scanning
- moderation scanning

Do not build full transcoding infrastructure unless necessary yet.

Stop after Phase 8.

---

# PHASE 9 — Creator and Subscriber Feeds

Build the user-facing content experience.

Routes:

```text
GET /feed
GET /creators/:creator/feed
```

The home feed should combine:

- public posts from followed/discovered creators
- unlocked subscription posts

Locked posts may return safe metadata such as:

```text
post ID
creator
createdAt
required tier
preview metadata
```

but NEVER include protected body/media data unless authorized.

Frontend:

```text
/feed
/c/:handle
/c/:handle/post/:id
/subscriptions
```

(`:handle` is the AT handle or DID — no slug; see `prompts/handle-identity.md`.)

Provide clear UI states:

```text
Public
Subscriber-only
Premium
Locked
Subscribed
```

Do not expose private storage URLs directly.

Stop after Phase 9.

---

# PHASE 10 — AT Protocol Public Discovery

Integrate public creator content more deeply with the AT ecosystem.

Build an ingestion layer capable of consuming the public Lexicons relevant to this application.

Research current recommended AT Protocol mechanisms before implementing.

Possible sources may include:

- Jetstream
- repo sync
- appropriate AppView architecture

Avoid operating a full Relay unless actually required.

Create an internal indexing system for:

```text
creator profiles
public posts
public subscription tier metadata
```

Implement:

```text
/discover
/search
```

Search by:

```text
creator name
handle
bio
```

Build the architecture so creators remain identified by DID even when their handles change. The index is keyed by DID; `handle` is a mutable attribute of the indexed record, not an identity. Reconcile with the `CreatorHandleHistory` / handle-change redirect from `prompts/handle-identity.md`: a `/c/<oldhandle>` visit must still land on the current creator (301/redirect), and search must not return a stale handle for a creator who has since changed it.

The ingestion layer must handle record deletes/tombstones from the source (not just creates/updates) and remove or hide the corresponding indexed content — an indexer that only applies creates will silently keep serving content the creator deleted from their own repo.

Stop after Phase 10.

---

# PHASE 11 — (vacated) AT Protocol Spaces

The experimental AT Protocol Spaces adapter that used to live here has been
**moved to [`prompts/atproto-spaces.md`](./atproto-spaces.md)** and runs **dead
last** — after `PHASE 12`–`PHASE 17` and after both rearchitecture phases
(`prompts/creator-owned-pds.md`, then `prompts/bluesky-public-posts.md`).

This slot is intentionally left vacant rather than renumbered, so that every
`Phase 12`–`Phase 17` cross-reference in these specs and in `docs/` still
resolves. There is no `PHASE 11` work in this file.

The `AtprotoSpacesContentRepository` stub defined in `PHASE 7` stays a stub
until `prompts/atproto-spaces.md` runs.

Next after `PHASE 10`: the two rearchitecture phases (see the preamble), then
`PHASE 12`.

---

# PHASE 12 — Comments, Likes, and Social Interaction

Implement:

```text
comments
likes
creator likes
subscriber comments
```

Database:

```text
Comment
Like
```

Every comment associated with protected content inherits access rules from the post.

Do not expose subscriber comments attached to protected content publicly through AT unless deliberately designed to do so.

Routes:

```text
POST /posts/:id/comments
GET  /posts/:id/comments
POST /posts/:id/likes
DELETE /posts/:id/likes
```

Add authorization tests.

Stop after Phase 12.

---

# PHASE 13 — Creator Dashboard

Build:

```text
/creator/dashboard
```

Display:

```text
subscriber count
active subscriptions
monthly recurring revenue
revenue by tier
new subscribers
cancellations
recent posts
```

Do not derive authoritative billing numbers from AT Protocol.

Billing database/provider data remains authoritative.

Add date filters.

Protect all creator analytics endpoints by ownership.

Stop after Phase 13.

---

# PHASE 14 — Trust and Safety Foundation

Build the moderation architecture before expanding the product.

Models:

```text
Report
ModerationCase
ContentLabel
UserBlock
CreatorBlock
AuditLog
```

Create user actions:

```text
report creator
report post
report comment
block user
```

Administrative moderation functionality should support:

```text
review reported content
restrict account
remove content
suspend creator
preserve audit trail
```

Build interfaces for future automated classifiers rather than hard-coding one provider.

Sensitive moderation actions require audit logging.

Design APIs with eventual requirements for:

- age verification
- identity verification
- consent records
- NCII response
- copyright takedowns
- illegal-content escalation
- geo restrictions

Because this platform is intended to support adult/NSFW content (see "Content policy" above), age verification and creator identity verification (KYC) are NOT purely future work: design `CreatorProfile`/`Creator` with an explicit verification-status field now, and make `PayoutProvider` onboarding (Phase 6) and the ability to mark a tier/post as containing adult content both depend on it. Do not enable real (non-fake) `PaymentProvider`/`PayoutProvider` implementations, and do not remove `ATPROTO_SPACES_ENABLED` style safety flags, until this is resolved. This is still a design/gating requirement, not an instruction to integrate a specific KYC vendor.

Do NOT invent legal compliance requirements.

Document places where legal/compliance review is required.

Note: transactional email/notifications (subscription receipts, cancellation confirmations, payout failures, moderation notices) are out of scope for all phases in this document. This is a deliberate gap, not an oversight — flag it in docs/architecture.md as required before real-money production launch.

Stop after Phase 14.

---

# PHASE 15 — Production Hardening

Perform a production-readiness pass.

Review:

## Authentication

- OAuth state
- PKCE
- session theft
- session rotation
- cookie settings
- login CSRF

## Authorization

Review every endpoint for:

```text
user ownership
creator ownership
subscription entitlement
moderator/admin access
```

## Media security

Attempt to bypass:

```text
signed URLs
tier restrictions
subscription expiration
creator ownership
```

## Billing

Verify:

```text
webhook idempotency
replayed events
out-of-order events
failed payments
cancellations
refund state
```

## Database

Add appropriate:

- indexes
- constraints
- foreign keys
- unique constraints

## API

Add:

- rate limiting
- request limits
- schema validation
- security headers

## Observability

Implement:

- structured logs
- metrics
- health checks
- readiness checks
- error reporting interface

Produce:

```text
docs/security.md
docs/threat-model.md
docs/production-readiness.md
```

Do not implement new product features.

Stop after Phase 15.

---

# PHASE 16 — Kubernetes Deployment

Create production-friendly Kubernetes manifests.

Support:

```text
API
Web
PostgreSQL connection
Redis connection
S3 configuration
Secrets
Ingress
TLS
autoscaling-ready configuration
```

Do NOT deploy PostgreSQL or S3 inside the cluster by default for production.

Assume managed/external persistent services.

Create:

```text
infrastructure/kubernetes/base
```

and environment overlays if appropriate.

Support:

```text
development
staging
production
```

Include:

- Deployments
- Services
- ConfigMaps
- Secret references
- Ingress
- readiness probes
- liveness probes
- PodDisruptionBudget where appropriate
- resource requests/limits

Do not commit secrets.

Stop after Phase 16.

---

# PHASE 17 — Architecture Review

Do not add features.

Review the entire repository.

Produce:

```text
docs/final-architecture.md
```

Include diagrams for:

## Authentication

```text
AT account
→ OAuth
→ application session
→ DID identity
```

## Public content

```text
creator
→ AT repository
→ AT network
→ AppView/indexer
→ website
```

## Paid content

```text
creator
→ private content repository
→ entitlement service
→ subscriber
```

## Future Spaces architecture

(Spaces is built in [`prompts/atproto-spaces.md`](./atproto-spaces.md), which
runs after this review. Post-rearchitecture it is a key-grant/permission
transport over encrypted creator-owned storage, so the diagram reads as a grant
path, not a storage path.)

```text
subscriber DID
→ application
→ Space Authority
→ subscription entitlement
→ Space credential (grant only; ciphertext stays on the creator's PDS)
→ creator Space
```

## Payments

```text
subscriber
→ payment provider
→ webhook
→ subscription state
→ entitlement
```

Identify:

- security risks
- scaling risks
- AT Protocol compatibility risks
- data portability limitations
- payment-provider coupling
- features that could become separate services later

Do not refactor merely for stylistic reasons.

Make only changes necessary to fix material architectural or security problems.

End with a concise list:

```text
Ready for MVP
Needs work before MVP
Future work
Experimental
```