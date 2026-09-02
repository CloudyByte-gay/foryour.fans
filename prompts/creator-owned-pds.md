# REARCHITECTURE PHASE — Creator-Owned PDS Storage

Runs after the current backend/web phases as a deliberate architecture pivot.
This prompt supersedes the earlier rule that subscriber-only content and
private media live in application-controlled Postgres/S3. The new product rule
is stronger:

**foryour.fans must not be the system of record for creator content, creator
media, or creator-authored business configuration. Creators publish and retain
their own data in their own PDS, so they can move between compatible
fan-service apps without export/import or platform custody.**

Companion files: [`prompts/full.md`](./full.md), [`prompts/web.md`](./web.md),
[`prompts/bluesky-public-posts.md`](./bluesky-public-posts.md),
[`prompts/atproto-spaces.md`](./atproto-spaces.md) (the extracted experimental
Spaces phase, run after this one),
[`docs/architecture.md`](../docs/architecture.md), and
[`docs/atproto-vs-database.md`](../docs/atproto-vs-database.md).

## Why

The current design uses AT Protocol for identity and public records, but keeps
subscriber-only posts, private media, subscriptions, payments, and operational
creator state in foryour.fans-owned infrastructure. That makes the app a
custodian for the most important creator data and prevents a creator from
moving their fan business to another compatible service without relying on this
service's database and object storage.

Change that boundary. The creator's PDS is the durable owner-controlled data
store for creator-authored data. foryour.fans becomes an app/viewer/payment
coordinator that reads and writes authorized records, caches only revocable or
rebuildable indexes, and can be replaced by another service that understands
the same lexicons.

## Non-negotiable Product Rules

1. **No foryour.fans-owned creator content.** Creator profiles, tiers, posts,
   media references, content gates, and creator-authored configuration are
   stored as records/blobs in the creator's own PDS.
2. **No proprietary creator lock-in.** A creator who controls their AT identity
   and PDS can move to another compatible fan-service app. That app can discover
   the creator's records and reconstruct the creator-facing surface without a
   private export from foryour.fans.
3. **Local Postgres is not source of truth for creator-authored data.** It may
   hold OAuth sessions, viewer app sessions, payment processor state,
   idempotency ledgers, moderation queues, and rebuildable indexes. It must not
   be the only copy of creator-authored content.
4. **Private/gated content still needs access control.** Moving content to the
   creator's PDS does not mean everything becomes public. Design record and blob
   access around explicit capability grants, encryption, or AT Protocol
   primitives that support permissioned content.
5. **Do not silently downgrade privacy.** If a secure creator-owned PDS storage
   mechanism cannot be implemented with today's AT Protocol/PDS capabilities,
   stop and document the blocker. Do not publish paid/private content as normal
   public repo records just to satisfy portability.
6. **Public posts are Bluesky-compatible.** A `PUBLIC` post authored through
   foryour.fans is stored on the creator's PDS as both
   `app.bsky.feed.post` and `fans.foryour.post`; see
   [`bluesky-public-posts.md`](./bluesky-public-posts.md). Gated posts are never
   published as normal public Bluesky posts.

## Shared Post Model

Use the same post taxonomy in this prompt and in
[`bluesky-public-posts.md`](./bluesky-public-posts.md):

- **Public dual-published post**: cleartext content authored for public
  distribution. It is written to the creator's PDS as both
  `app.bsky.feed.post` and `fans.foryour.post`, linked by AT URI/CID metadata,
  and rendered as one merged item in foryour.fans feeds.
- **Public Bluesky-only post**: a normal `app.bsky.feed.post` by the creator
  that was not authored through foryour.fans. foryour.fans may index and show it
  in feeds, but it is not a gated creator-content record.
- **Public custom-only post**: a `fans.foryour.post` record without a linked
  Bluesky post. Keep supporting it for compatibility with other fan-service
  clients, but do not create this shape from the foryour.fans public composer
  unless Bluesky publishing is unavailable and the UI clearly says so.
- **Gated encrypted post**: subscriber-only or tier-gated content. The post
  body/media are encrypted before writing to the creator's PDS and are never
  written as `app.bsky.feed.post`.

## Target Architecture

### Creator PDS

The creator's PDS owns:

- `fans.foryour.profile`
- `fans.foryour.tier`
- `fans.foryour.post`
- `app.bsky.feed.post` for public posts authored through foryour.fans
- media blobs for public and gated posts
- attachment manifests
- post visibility/gating metadata
- creator-owned service configuration needed by any compatible fan-service app

### foryour.fans Private Infrastructure

Postgres may keep:

- user rows keyed by DID, as a cache of profile fields and app relationship
  state
- AT OAuth session material needed to act with user authorization
- app session tokens
- payment customer/subscription/provider state
- webhook idempotency ledgers
- access-grant/cache rows that are derivable from PDS records plus payment
  state
- discovery/search indexes derived from public or authorized records
- moderation/admin workflow records

Any subscriber/payment data kept by foryour.fans must be the minimum operational
state needed to verify active paid entitlement, process webhooks, and satisfy
legal/accounting obligations. It must not become the portable creator business
record. Creator-authored data and encrypted content remain PDS-owned.

Postgres must not keep:

- the only copy of a creator post body
- the only copy of creator media bytes
- tier definitions as app-owned truth
- creator profile truth
- subscriber-only media in app-owned object storage as the durable store

S3/MinIO/R2 may be used only as:

- a temporary upload staging area before committing to the creator's PDS
- a short-lived cache with explicit TTL and invalidation
- generated derivatives that can be recreated from creator-owned source data

It must not be the durable source of creator media.

## Required Research Before Implementation

Before changing code, research and document the current AT Protocol/PDS options
for permissioned creator-owned content:

- normal repo records and their replication/publicness properties
- `com.atproto.repo.uploadBlob` limits and visibility semantics
- whether PDS blob access can be permissioned or should be assumed public to
  anyone with a blob reference/CID
- AT Protocol Spaces or successor mechanisms for permissioned content
- encrypted blobs stored on PDS with keys granted out-of-band
- how another fan-service app would discover, verify, and render the records
- deletion/takedown semantics for records and blobs
- PDS portability/export/import behavior for custom lexicon records and blobs
- how `app.bsky.feed.post` and `fans.foryour.post` should link together for
  public posts, deferring exact Bluesky field details to
  `docs/bluesky-public-posts.md`

The output of this research must be committed as
`docs/creator-owned-pds.md` before implementation starts. Include concrete
source links and mark any design assumption that is not guaranteed by the
protocol today.

## Required Privacy Design

Use encrypted PDS records and blobs for gated content. Public records may remain
plain public AT records, but any subscriber-only or tier-gated post body/media
must be encrypted before it is written to the creator's PDS.

Only subscribers with a currently paid, active entitlement may receive the
decryption material needed to view gated content. A cancelled, expired,
past-due, pending, refunded, or otherwise inactive subscription must not be able
to fetch new decryption grants.

The PDS owns the encrypted content. foryour.fans may coordinate payment,
entitlement checks, and key delivery, but the ciphertext remains portable with
the creator's account.

The portable records must describe the access policy and key-grant protocol
well enough that a compatible fan-service app can implement its own payment
relationship and issue keys to currently active paid subscribers. Do not make
for-your-fans-specific database IDs the only way to understand who a post is
for.

## Rejected Privacy Designs

Do not use these for paid/gated content:

- plain public repo records containing private post bodies
- plain public PDS blobs containing private media
- app-owned S3/MinIO/R2 as the durable media store
- local Postgres as the only copy of a private post body
- access control that depends only on hiding an unencrypted blob URL

### Protocol-Native Permissioning

AT Protocol Spaces or a successor permissioned-content primitive may be used
only if it still preserves the encrypted creator-owned storage rule. Treat
protocol-native grants as a transport/access layer, not a reason to publish paid
content unencrypted.

Requirements:

- gated post bodies and media are stored in creator-owned permissioned storage
- subscribers receive access through protocol-native grants
- another compatible fan-service app can verify access without asking
  foryour.fans for the content
- revocation, cancellation, and tier changes have explicit behavior

### Encrypted PDS Records and Blobs

Store encrypted post bodies/media on the creator's PDS. foryour.fans may
coordinate payment and key grants, but the encrypted content remains portable.

Requirements:

- post bodies are encrypted before upload
- media bytes are encrypted before upload
- record metadata reveals only what is acceptable to reveal publicly
- subscribers receive decryption keys/capabilities after entitlement checks
- key rotation/revocation behavior is documented honestly
- another compatible service can implement the same key-grant protocol

### Stop and Defer

If encrypted PDS storage cannot be made safe enough with the current protocol
surface, do not continue implementing paid private media. Ship only public
creator-owned content and leave paid/private content blocked behind a documented
protocol gap.

## Entitlement and Key Grants

Implement key delivery as a first-class domain boundary.

Requirements:

- A subscriber can request a decryption grant only after the API verifies:
  - the subscriber is authenticated by DID
  - the subscription belongs to the target creator
  - the subscription status is `ACTIVE`
  - the subscription is paid/current according to provider state
  - the subscription tier satisfies the post's access policy
- `PENDING`, `PAST_DUE`, `CANCELED`, `EXPIRED`, chargeback/refund, or missing
  provider state must deny key delivery.
- The browser must never receive keys for posts/media the current viewer cannot
  access.
- Keys must be scoped as narrowly as practical: prefer per-post or per-media
  content keys over one long-lived creator-wide key.
- Store content encryption keys encrypted at rest if they are stored by
  foryour.fans at all.
- Document whether keys are generated by the creator client, the server, or a
  KMS, and what trust that places in foryour.fans.
- Revocation must be honest: cancellation can stop future key grants, but it
  cannot make already-downloaded plaintext unseen. If cached keys can be
  expired, enforce and test that expiry.
- Another compatible fan-service app must be able to perform the same
  entitlement/key-grant flow from the creator-owned records plus its own
  payment/subscription relationship with the viewer.

## Lexicon Changes

Redesign the lexicons so they describe a portable creator business surface
rather than a mirror of app-owned database tables.

Minimum records:

- `fans.foryour.profile`
- `fans.foryour.tier`
- `fans.foryour.post`
- `fans.foryour.media`
- `fans.foryour.accessPolicy`
- `fans.foryour.serviceConfig`

`fans.foryour.post` must support:

- public posts
- subscriber-gated posts
- tier-gated posts
- optional linkage to a paired `app.bsky.feed.post`:
  - `bskyUri`
  - `bskyCid`
  - `canonicalUri`
  - `sourceApp`
- references to PDS-owned media/blob records
- content labels and content warnings
- created/updated timestamps
- enough stable IDs/rkeys for edits, deletes, migration, and indexing

`fans.foryour.media` must support:

- blob reference/CID
- mime type
- size
- width/height/duration where known
- encryption metadata for gated media
- content labels and content warnings
- relationship to one or more posts without forcing media bytes into
  foryour.fans storage

`fans.foryour.accessPolicy` must support:

- public
- subscribers
- tier minimum
- stable tier references by AT URI/rkey, not only local database IDs
- key-grant method metadata for encrypted gated content
- future bundles/promotions without breaking existing records

`fans.foryour.serviceConfig` must support:

- creator-selected compatible fan-service endpoints
- key-grant endpoint discovery
- payment/entitlement issuer metadata where needed
- migration between compatible services without changing the content records
- no embedded subscriber lists, legal names, payment customer IDs, or private
  billing data

Do not add payment processor customer IDs, legal names, tax info, payout info,
or subscriber lists to public records. If a field would expose private
subscriber identity or billing data to the open network, it belongs outside
normal public records or must be encrypted/capability-scoped.

## Backend Refactor

### `packages/database`

- Replace durable creator-content tables with cache/index tables.
- Rename or rebuild `Creator`, `SubscriptionTier`, `Post`, `PostMedia`, and
  `MediaAsset` usage so code cannot accidentally treat them as authoritative
  content stores.
- Add explicit fields such as `sourceUri`, `sourceCid`, `indexedAt`,
  `cacheExpiresAt`, and `isAuthoritative: false` where useful.
- Keep payment/subscription/provider tables only for service-specific payment
  coordination, not for owning creator content.

### `packages/atproto`

- Add typed helpers for:
  - writing creator-owned records
  - writing standard `app.bsky.feed.post` records for public posts
  - reading records by AT URI
  - listing records by collection
  - uploading blobs to the creator's PDS
  - resolving blob refs/media from records
  - deleting/tombstoning records
- All writes must use the creator's OAuth session and target `repo:
  creator.did`.
- No code path may upload creator media to app-owned S3 as durable storage.

### `packages/media`

- Convert from durable object storage to PDS upload/encryption orchestration.
- If using encrypted blobs, encryption must happen client-side or server-side
  before upload to the PDS, with a documented threat model.
- S3-compatible storage may remain only as temporary staging/cache and must have
  TTL cleanup.

### `packages/content`

- Replace `PrivateContentRepository` with a creator-owned content repository.
- Repository methods should read/write AT records and PDS blobs, with local
  indexes used only for query acceleration.
- `SUBSCRIBERS` and `TIER` content must no longer be Postgres-only.

### `packages/discovery`

- Index portable records from the open network or authorized feeds.
- Index both public post collections: `fans.foryour.post` and
  `app.bsky.feed.post`.
- Merge linked public records into one feed item using the rules in
  [`bluesky-public-posts.md`](./bluesky-public-posts.md).
- Public discovery must not index encrypted private bodies or private media.
- Index tombstones/deletes and update local cache state accordingly.

### `apps/api`

- Rewrite creator, tier, post, feed, and media routes to treat the PDS as the
  authoritative creator-content store.
- Public post routes must dual-publish to `app.bsky.feed.post` and
  `fans.foryour.post`; gated routes must publish only encrypted custom records.
- API responses may be served from cache only when the cache includes enough
  source URI/CID metadata to validate freshness or clearly mark staleness.
- Mutating routes must publish to the creator's PDS first, then update local
  caches/indexes.
- Add administrative endpoints only for service-specific state, not for
  modifying creator-owned records without creator authorization.

## Web Refactor

- Creator settings must say that creator content and configuration are stored
  on the creator's PDS.
- Media upload UI must upload to the creator-owned path selected above.
- Composer must clearly distinguish public dual-published Bluesky-compatible
  posts from gated encrypted posts, without implying gated content is stored by
  foryour.fans or published to Bluesky feeds.
- Feeds must render public `app.bsky.feed.post`, public `fans.foryour.post`, and
  dual-published merged posts alongside locked/unlocked gated encrypted posts.
- Add a portability/status panel showing:
  - DID
  - current handle
  - PDS URL
  - record collections used
  - last sync/index time
  - export/import is not needed when moving to a compatible service

Do not add marketing copy that overclaims privacy or deletion guarantees.
If PDS blobs/records replicate publicly, say so in the UI before publishing.

## Migration Plan

For existing local development data:

1. Add a one-off migration command that reads local creator content and writes
   equivalent records/blobs to each creator's PDS using their OAuth session.
2. Record the generated AT URIs/CIDs in local cache/index tables.
3. Verify round-trip reads from the PDS before deleting or deauthoritizing local
   durable content columns.
4. Leave local rows as cache for one release, then remove durable content
   columns in a later migration.

If a creator's OAuth session is unavailable, mark their content as
`migration_required` and do not delete local data until they reauthorize and the
PDS write succeeds.

## Tests

Add tests that prove:

- creator post bodies are never stored as authoritative Postgres data
- media bytes are never durably stored in app-owned S3/MinIO
- public posts can be reconstructed from PDS records alone, including the paired
  `app.bsky.feed.post` and `fans.foryour.post` shape for posts authored here
- gated posts can be reconstructed from PDS records plus the chosen access/key
  mechanism
- dual-published public records render as one feed item, not two
- another simulated fan-service app can read the same creator-owned records
- deleting/tombstoning records updates local caches
- failed PDS writes do not create authoritative local content
- payment/subscription state never leaks into public PDS records

Include one integration test against a real or local PDS where feasible. If no
local PDS test harness exists, create one or explicitly document the blocker.

## Documentation Updates

Update:

- `README.md`
- `docs/architecture.md`
- `docs/atproto-vs-database.md`
- `docs/creator-owned-pds.md`
- `docs/bluesky-public-posts.md`
- `docs/build-plan.md`

The docs must state plainly:

- foryour.fans does not own creator content
- creator data portability depends on the creator's DID/PDS
- compatible services can render the same creator records
- public posts authored here are normal Bluesky posts as well as foryour.fans
  records
- gated encrypted posts never become normal public Bluesky posts
- which data remains service-specific and why
- any protocol limitations around private/gated PDS content

## Exit Checklist

Before marking this rearchitecture complete:

1. `pnpm build`
2. `pnpm lint`
3. `pnpm typecheck`
4. `pnpm test`
5. Docker stack starts cleanly
6. A creator can publish profile, tiers, posts, and media to their own PDS
7. The app can rebuild creator pages from PDS records after clearing local
   content caches
8. Gated content access follows the selected privacy design
9. Public posts authored here appear as normal `app.bsky.feed.post` records and
   linked `fans.foryour.post` records
10. No durable app-owned creator media remains
11. Known protocol limitations are documented without product overclaiming

**Stop after the architecture docs and backend proof-of-concept are complete.
Do not continue into production migration until the privacy design has been
reviewed.**
