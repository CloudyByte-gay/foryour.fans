# Creator-Owned PDS Storage — Protocol Research

This is the "Required Research Before Implementation" output of
[`prompts/creator-owned-pds.md`](../prompts/creator-owned-pds.md). It documents
what today's AT Protocol / PDS surface actually offers for **creator-owned,
optionally-permissioned content**, so the rearchitecture is built on verified
behaviour rather than assumption.

Every claim below is tagged:

- **[SPEC]** — stated in an atproto specification or reference implementation.
- **[OBSERVED]** — checked against a live PDS / relay during this research.
- **[ASSUMPTION]** — a design assumption **not** guaranteed by the protocol
  today. Each one is a risk the privacy review must accept or reject.

Research date: 2026-09-02. Re-verify anything **[ASSUMPTION]**-tagged before it
becomes load-bearing in production.

---

## 0. TL;DR / decision

| Content class | Where it lives after this phase | Status |
|---|---|---|
| Creator profile (`fans.foryour.profile`) | creator's PDS, public record | **ship** |
| Tiers (`fans.foryour.tier`) | creator's PDS, public record | **ship** |
| Service config (`fans.foryour.serviceConfig`) | creator's PDS, public record | **ship** |
| Public posts (`fans.foryour.post` + `app.bsky.feed.post`) | creator's PDS, public records + public blobs | **ship** (dual-publish detail: [`bluesky-public-posts.md`](../prompts/bluesky-public-posts.md)) |
| Public media (`fans.foryour.media`) | creator's PDS, public blob | **ship** |
| **Gated post bodies / media** (`SUBSCRIBERS`, `TIER`) | **encrypted**, creator's PDS | **DEFERRED behind a documented protocol gap** — see §7 |

**Why gated content is deferred:** there is no protocol-native way today to
store subscriber-only content on a creator's PDS that is simultaneously
(a) portable, (b) confidential against the open network, and (c) revocable.
Every available mechanism fails at least one:

- **Plain repo records/blobs** are fully public and firehose-replicated
  ([§1](#1-repo-records), [§2](#2-blobs)). Rejected by the spec's Rule 1 and
  Rule 5.
- **Encrypting records/blobs in the normal repo** puts ciphertext on the
  permanent, publicly-archived firehose, where it can be attacked offline
  indefinitely and leaks metadata. atproto maintainers explicitly discourage
  this ([§4](#4-encrypted-records-in-the-normal-repo)).
- **atproto Spaces / permissioned data** ([§3](#3-atproto-spaces--permissioned-data))
  keeps data off the firehose and adds real access control, but is **alpha**,
  explicitly not for production, subject to breaking changes, and provides
  **"access control, not confidentiality"** — the hosting PDS and authorised
  apps can read the plaintext.

The spec's ["Stop and Defer"](../prompts/creator-owned-pds.md) clause applies.
This phase ships **public** creator-owned content and builds the gated path as
a **flag-gated proof-of-concept** (`CREATOR_OWNED_GATED_CONTENT_ENABLED`,
default `false`) so the mechanism is demonstrable and reviewable without a
silent privacy downgrade in production.

---

## 1. Repo records

**[SPEC]** An atproto repository is a signed key/value store — a Merkle Search
Tree mapping `<collection>/<rkey>` paths to CBOR record values, with a single
signed root commit CID. Repository contents are *"entirely public and
verifiable"* and self-certifying.
Source: <https://atproto.com/specs/repository>

**[SPEC]** Record keys: this app already uses `tid` keys (timestamp-ids,
chronologically sortable within a collection) for `fans.foryour.tier` /
`fans.foryour.post`, and `literal:self` for `fans.foryour.profile`. That stays.
Source: <https://atproto.com/specs/record-key>

**[SPEC]** Writes go through `com.atproto.repo.applyWrites` /
`putRecord` / `createRecord` / `deleteRecord`; reads through
`com.atproto.repo.getRecord` and `com.atproto.repo.listRecords` (paginated,
`cursor` + `limit`, `reverse` for oldest-first).
Source: <https://docs.bsky.app/docs/api/com-atproto-repo-list-records>

**[SPEC]** Replication: every repo commit is broadcast on the PDS's
`com.atproto.sync.subscribeRepos` firehose, aggregated by relays, and
re-broadcast to any consumer (this app's Jetstream ingestor in
`packages/discovery` is one). A record is world-readable the instant it is
committed.

**[SPEC]** Deletion leaves **no tombstone inside the repo** — the MST simply no
longer contains the path. But a `#delete` event *is* emitted on the firehose,
and relays / AppViews / other apps that already indexed the record decide for
themselves whether to honour it. Deletion is therefore **best-effort
propagation, not guaranteed erasure** — the same rule `prompts/full.md` already
states for Phase 10, and `packages/discovery` already handles `delete` commit
events by removing the local `IndexedPost` row.
Source: <https://atproto.com/specs/repository>,
<https://atproto.com/specs/sync>

**Consequence for this phase:** anything written as a normal
`fans.foryour.*` record is public forever (best-effort deletable). Fine for
profile/tier/serviceConfig/public-post. Disqualifying for gated bodies.

---

## 2. Blobs

**[SPEC]** Media is uploaded with `com.atproto.repo.uploadBlob`, which returns a
`blob` object (`{$type: "blob", ref: <CID>, mimeType, size}`). The upload sits
in **temporary, inaccessible** storage and is **garbage-collected** if no
record references it within a grace window (reference PDS: ~hours, "at least one
hour a firm lower bound").
Source: <https://atproto.com/specs/blob>

**[SPEC]** Once **any** record in the repo references the blob's CID, the blob
becomes **publicly fetchable** via `com.atproto.sync.getBlob?did=<did>&cid=<cid>`.
There is **no per-viewer authorization** on `getBlob`. The blob spec's security
guidance is about *serving* (proxy through a CDN, set `Content-Security-Policy`,
never hand raw blobs to a browser) — not about *restricting* who may fetch.
Source: <https://atproto.com/specs/blob>,
<https://docs.bsky.app/docs/api/com-atproto-sync-get-blob>

**[OBSERVED]** `GET https://<pds>/xrpc/com.atproto.sync.getBlob?did=…&cid=…`
returns the bytes with no auth header. The referencing record's CID is itself
public (it's in the public repo), so "hide the blob URL" is not access control.

**[SPEC]** Blob GC on unreference: when the last record referencing a blob is
deleted, the PDS *may* delete the blob. Timing is implementation-defined; treat
blob deletion as best-effort, like record deletion.

**[ASSUMPTION]** Per-blob size limit. The reference PDS recommends *total* blob
quota over per-blob limits, and Bluesky's production PDS accepts images up to
~1 MB and videos via a separate pipeline. We assume a **conservative 5 MB
per-blob ceiling** for `fans.foryour.media` and validate client-side; a
creator's self-hosted PDS may allow more or less. Re-verify against the target
PDS's `describeServer` limits before relying on any specific number.

**Consequence:** public post media → `fans.foryour.media` + PDS blob, good.
Gated media as a plain blob → **rejected** (world-readable).

---

## 3. atproto Spaces / permissioned data

**[SPEC]** Proposal `0016-permissioned-data`; shipped as the **"atproto Spaces
alpha"** (2025). A *Space* is an authorization + sync boundary identified by
`(space authority DID, space type NSID, space key)`. It is designed for exactly
this use case — the proposal names *"gated content (paid newsletters)"* as a
target modality.
Sources: <https://github.com/bluesky-social/proposals/tree/main/0016-permissioned-data>,
<https://atproto.com/blog/atproto-spaces-alpha>,
<https://docs.bsky.app/blog/2025-protocol-roadmap-spring>

**[SPEC]** How access works: the viewer's PDS issues a short-lived *delegation
token* (default ~2 h); the app exchanges it with the *space authority* for a
DPoP-bound *space credential*; the credential is scoped by OAuth `space:` scopes
(space type, authority, collection, action). Permissioned data is **synced
directly PDS→app, never via the public firehose**. Account-level events
(identity, key rotation) still come from the normal firehose.

**[SPEC]** Revocation: the space authority stops issuing credentials, or deletes
the space, which emits `notifySpaceDeleted` telling syncers to discard their
copies. Credentials also simply expire.

**[SPEC] — the blocker:** *"The permissioned data protocol provides **access
control, not confidentiality**. It is not end-to-end encrypted. Services (both
PDSes and authorized applications) can read the data they handle"* — required
for search/index/notification/moderation. E2E encryption is *"a separate
concern that may be layered on top by an application."*

**[SPEC]** Maturity: *"a proposal, not the final specification"*, *"there will
be breaking changes, and you absolutely should not run production code against
it"*, implementation *"very much a work in progress."*

**Consequence:** Spaces is the right long-term **transport/access layer** and is
what [`prompts/atproto-spaces.md`](../prompts/atproto-spaces.md) will adopt
(dead last, after this phase). It is **not adoptable now** (alpha, unstable) and
even when stable it does **not** by itself satisfy the spec's Rule 4/Required
Privacy Design, which demand the gated payload be *encrypted* so the creator —
not the hosting PDS or the app — is the trust root. Spaces + app-layer
encryption is the eventual shape; neither half is production-ready today.

---

## 4. Encrypted records in the normal repo

**[OBSERVED, community]** Multiple atproto projects have tried client-side
encryption of normal repo records (AES-256-GCM bodies, keys derived per-DID).
atproto maintainers **discourage** it:

- The ciphertext lands on the **permanent, publicly-archived firehose**. Every
  relay and archiver keeps a copy. That is an offline attack target *forever* —
  no forward secrecy, no key rotation can un-leak an already-archived blob.
- **Metadata leaks**: record existence, size, timing, collection, rkey,
  reference graph, and the author DID are all still public even when the value
  is ciphertext. For a fan platform this alone deanonymises "who subscribes to
  whom" and "how much gated content exists."
- **Fail-dangerous writes**: a PDS that doesn't understand a "private" NSID
  convention will happily publish the record to the firehose anyway. There is
  no protocol flag that *guarantees* a record stays out of the public stream
  (that guarantee is exactly what Spaces adds).

Sources: <https://github.com/bluesky-social/atproto/discussions/3363>,
<https://github.com/bluesky-social/atproto/discussions/1409>,
<https://dholms.leaflet.pub/3mfrsbcn2gk2a>

**Consequence:** encrypting into the normal repo satisfies "portable" and
"creator-owned" but **fails "confidential"** in a way that is unfixable after
the fact. Rejected for production. Acceptable *only* as the flag-gated PoC in a
local dev environment with no real relay archiving the local PDS.

---

## 5. How another fan-service app discovers & renders these records

**[SPEC]** Given a creator's handle or DID:

1. Resolve DID → DID document → PDS service endpoint
   (`com.atproto.identity.resolveHandle`, then the PLC / `did:web` doc).
2. `com.atproto.repo.listRecords?repo=<did>&collection=fans.foryour.profile`
   → the `self` profile record.
3. Same for `collection=fans.foryour.tier`, `fans.foryour.post`,
   `fans.foryour.serviceConfig`, `fans.foryour.media`.
4. Resolve blob refs via `com.atproto.sync.getBlob`.
5. Verify: records are signed under the repo's commit; the commit is signed by
   a key in the DID document. No trust in foryour.fans required.

**[OBSERVED]** `listRecords` on a live PDS is unauthenticated and CORS-open for
public collections — a third-party app needs only the DID.

**Consequence:** portability Rule 2 is *satisfied for public content* with no
foryour.fans involvement. For gated content, the portable records
(`fans.foryour.post` with an `accessPolicy`, `fans.foryour.accessPolicy`)
describe *who* a post is for and *how* to request a key — a competing app
implements its own payment relationship and its own key issuance from that
description. What is **not** portable today is the encrypted payload transport
(see §7).

---

## 6. Deletion / takedown

**[SPEC]** Record delete → MST no longer contains it, `#delete` on firehose,
best-effort downstream. Blob delete → best-effort on last unreference.
**[SPEC]** Account-level takedown (`com.atproto.admin.updateSubjectStatus`) is a
PDS-operator action; a creator on their own PDS is their own operator.
**[ASSUMPTION]** foryour.fans, holding only an OAuth session, can delete
*records and blobs it wrote* but cannot force-erase copies already replicated
off the creator's PDS. UI copy must not promise hard deletion (spec's Web
Refactor rule).

---

## 7. Portability / export / import of custom records + blobs

**[SPEC]** Account migration: `com.atproto.sync.getRepo` → CAR file (contains
**all** records including custom `fans.foryour.*`), `com.atproto.repo.importRepo`
on the destination PDS, then blobs copied one-by-one
(`com.atproto.repo.listMissingBlobs` + `getBlob`/`uploadBlob`), rate-limited
(~1000 blobs / 24 h / IP on the reference PDS). DID, handle, and all CIDs are
preserved.
Source: <https://atproto.com/guides/account-migration>

**Consequence:** a creator moving PDS keeps every `fans.foryour.*` record and
public blob automatically — this is the "no export/import needed" property the
product promises, and it comes for free from atproto's own migration path. The
new fan-service app just re-runs the §5 discovery flow against the new PDS.

**The gated-payload gap:** there is **no standard** for migrating an encrypted
side-channel payload or a Space's contents between apps today. If gated content
were shipped now via app-held ciphertext, moving apps *would* require a
foryour.fans-specific export — violating Rule 2. This is the concrete reason
gated content waits for Spaces (which defines `notifySpaceDeleted` / re-sync
semantics) or a ratified encrypted-content lexicon.

---

## 8. `app.bsky.feed.post` linkage

Deferred to [`prompts/bluesky-public-posts.md`](../prompts/bluesky-public-posts.md)
and its research output `docs/bluesky-public-posts.md`, per this phase's spec.
This phase only reserves the linkage fields on `fans.foryour.post`
(`bskyUri`, `bskyCid`, `canonicalUri`, `sourceApp`) and the merge rule
(a `fans.foryour.post` whose `bskyUri` resolves to an `app.bsky.feed.post` by
the same DID is **one** feed item). Field-level Bluesky rules
(text length, facets, embed shapes, blob limits) are that phase's to verify.

---

## 9. What this phase actually builds

| Layer | Change |
|---|---|
| `packages/lexicons` | New `fans.foryour.media`, `fans.foryour.accessPolicy`, `fans.foryour.serviceConfig`. `fans.foryour.post` gains optional `visibility`, `accessPolicy`, `media[]`, `bskyUri`/`bskyCid`/`canonicalUri`/`sourceApp`, `encryption`, `updatedAt` — all optional, so every existing record still validates. |
| `packages/atproto` | `getRecord`, `listRecords`, `uploadBlob`, `getBlobUrl` helpers + DI interfaces, all bound to `repo: creator.did` via the creator's OAuth session. |
| `packages/crypto` (new) | `ContentCipher`: AES-256-GCM per-post content keys, envelope-wrapped with a server key (documented threat model). Used only when the gated flag is on. |
| `packages/database` | Additive migration: `sourceUri`/`sourceCid`/`isAuthoritative`/`indexedAt`/`cacheExpiresAt` columns on `Creator`/`SubscriptionTier`/`Post`/`MediaAsset` (nullable, default preserves today's behaviour). New `ContentKey` (wrapped per-post key, encrypted at rest) + `ContentKeyGrant` (revocable subscriber grant) tables. |
| `packages/content` | `CreatorOwnedContentRepository implements ContentRepository`: public posts dual-publish to the creator's PDS then cache locally with `isAuthoritative:false`; gated posts encrypt + write to the PDS **only when `CREATOR_OWNED_GATED_CONTENT_ENABLED`**, else delegate to the existing `PrivateContentRepository` (deferred). `rebuildFromPds(did)` reconstructs cache rows from PDS records alone. |
| `packages/subscriptions` | `KeyGrantService`: issues a per-post content key **only** after `canAccess` + `ACTIVE` + paid-current checks; denies `PENDING`/`PAST_DUE`/`CANCELED`/`EXPIRED`/missing; records a revocable, expiring `ContentKeyGrant`. |
| `apps/api` | `POST /content-keys/grant` (key-grant flow), `GET /creators/me/portability` (DID/handle/PDS/collections/last-sync panel data). Repository wiring chosen by `CREATOR_OWNED_PDS_ENABLED` (default `false` → Phase 1–10 behaviour unchanged). One-off `scripts/migrate-to-pds.ts`. |

Nothing above changes the default runtime behaviour of the app: both new flags
default off, both new routes are additive, every schema change is a nullable
add. The PoC is exercised entirely through new tests + the two flags.

---

## 10. Open questions for the privacy review

1. Is a **flag-gated, dev-only** encrypted-repo PoC an acceptable way to prove
   the mechanism, given §4's "unfixable once archived" property? (This doc
   assumes yes *only* because a local dev PDS has no archiving relay.)
2. When Spaces stabilises, is *"Spaces transport + app-layer AES-GCM payload"*
   the target, with foryour.fans as space authority + key issuer? Or should the
   creator's client hold the root key (foryour.fans never sees plaintext),
   accepting that server-side search/moderation of gated content becomes
   impossible?
3. Key custody: this PoC generates content keys **server-side** and envelope-
   wraps them with a server key (`CONTENT_KEY_WRAP_SECRET`). That means
   foryour.fans *can* decrypt gated content. Acceptable as an interim, or must
   the creator client be the only key generator from day one?
4. Grant expiry: the PoC issues 24 h `ContentKeyGrant`s and re-checks
   entitlement on renewal. Is a shorter window required? Is "already-downloaded
   plaintext stays downloaded" (no DRM) acceptable product-side? (Spec says it
   must be — revocation is honest about this.)
5. Metadata: even deferred, a gated `fans.foryour.post` with an `accessPolicy`
   ref and `encryption` metadata reveals *"this creator has N gated posts, of
   sizes …, gated at tier X"* if written publicly. Confirm that's acceptable
   before the gated flag is ever turned on outside dev.
