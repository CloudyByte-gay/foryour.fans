# REFACTOR PHASE — Public Posts Also Publish as Bluesky Feed Posts

Runs after the current post/feed implementation and before any production
launch. This prompt fixes a product gap: public posts created on foryour.fans
must not be visible only to foryour.fans clients. They should also be normal
Bluesky-compatible feed posts, so they can appear in Bluesky timelines, feeds,
profiles, search, embeds, and third-party AppViews that understand
`app.bsky.feed.post`.

Companion files: [`prompts/full.md`](./full.md), [`prompts/web.md`](./web.md),
[`prompts/creator-owned-pds.md`](./creator-owned-pds.md),
[`docs/architecture.md`](../docs/architecture.md), and
[`docs/atproto-vs-database.md`](../docs/atproto-vs-database.md).

## Relationship to Creator-Owned PDS Storage

This prompt and [`creator-owned-pds.md`](./creator-owned-pds.md) are
complementary:

- This prompt defines the public-post interoperability rule: public posts are
  normal Bluesky posts and foryour.fans records.
- `creator-owned-pds.md` defines the durable ownership and privacy rule:
  creator content lives on the creator's PDS, and gated content is encrypted.
- If this prompt is implemented first, keep local Postgres/S3 behavior only as
  the existing temporary architecture, and shape new fields so the later
  creator-owned PDS migration can convert them into cache/index metadata.
- If `creator-owned-pds.md` is implemented first, this prompt must operate only
  on creator-owned PDS records/caches and must not reintroduce app-owned
  authoritative post/media storage.

## Product Rule

Every `PUBLIC` post authored through foryour.fans must be written to the
creator's own PDS in two compatible forms:

1. `app.bsky.feed.post` — the normal Bluesky post format, so Bluesky and
   Bluesky-compatible clients can display it.
2. `fans.foryour.post` — the foryour.fans portable creator-content record,
   carrying fan-service-specific metadata that the normal Bluesky post format
   cannot represent.

Subscriber-only and tier-gated posts must not be written as plain
`app.bsky.feed.post` records. They remain gated/encrypted per
[`creator-owned-pds.md`](./creator-owned-pds.md).

## Shared Post Model

Use the same post taxonomy in both prompts:

- **Public dual-published post**: cleartext content authored through
  foryour.fans for public distribution. It is written as both
  `app.bsky.feed.post` and `fans.foryour.post`, linked by AT URI/CID metadata,
  and rendered once.
- **Public Bluesky-only post**: a normal `app.bsky.feed.post` authored outside
  foryour.fans. It may appear in foryour.fans feeds if included by the API, but
  it has no foryour.fans gating metadata.
- **Public custom-only post**: a `fans.foryour.post` without a linked Bluesky
  record. Support it for interoperability with other fan-service clients, but
  do not create it from the normal public composer unless Bluesky publishing is
  unavailable and the UI states the limitation.
- **Gated encrypted post**: subscriber-only or tier-gated content. It may have
  public-safe metadata, but its body/media are encrypted and it is never
  published as `app.bsky.feed.post`.

## Required Research Before Implementation

Before changing code, verify the current `app.bsky.feed.post` lexicon and
Bluesky publishing behavior from primary sources.

Document in `docs/bluesky-public-posts.md`:

- required and optional fields for `app.bsky.feed.post`
- current text length and facet rules
- link/mention/hashtag facet shape
- image/video/embed records and blob constraints
- whether custom records can safely reference a Bluesky post URI/CID
- whether a Bluesky post can include or link back to a custom
  `fans.foryour.post` record
- what metadata can be safely public when a custom post points to encrypted
  gated content
- deletion behavior when both records exist
- indexing behavior for normal Bluesky feeds and for custom lexicon records

Do not rely on stale memory for lexicon details. If official docs and live
behavior disagree, document the live behavior and keep the implementation
compatible with the production network.

## Record Relationship

For every public post, store enough metadata to relate the two PDS records:

- `fans.foryour.post` has its own rkey and AT URI.
- `app.bsky.feed.post` has its own rkey and AT URI.
- The local cache/index stores both URIs and CIDs.
- The custom record should reference the Bluesky record when the lexicon allows
  it.
- If the Bluesky record can safely include a backlink to the custom record,
  include one only if it does not degrade the normal Bluesky reading
  experience.

The normal Bluesky post must be readable and useful on its own. Do not make it
look like an opaque app notification such as "view this post on foryour.fans"
for ordinary public content.

Do not create a normal Bluesky post as a teaser for gated content unless that
teaser itself is intentionally public, contains no private body/media, and is
represented as a separate public post from the encrypted gated post.

## Backend Changes

### `packages/lexicons`

- Vendor or pin the current `app.bsky.feed.post` lexicon if generated types are
  needed locally.
- Extend `fans.foryour.post` to include optional linkage metadata:
  - `bskyUri`
  - `bskyCid`
  - `canonicalUri`
  - `sourceApp`
- Align the `fans.foryour.post` shape with `creator-owned-pds.md`:
  - public records may contain cleartext body/media references
  - gated records contain public-safe metadata plus encrypted payload/media
    references
  - access policy references must not expose subscriber lists or payment data
- Keep the custom record valid even if a user or another client creates only a
  `fans.foryour.post` record without a paired Bluesky post.

### `packages/database`

Update the local post/cache model so a public post can track both record
families:

- `foryourAtUri`
- `foryourAtCid`
- `foryourAtRkey`
- `bskyAtUri`
- `bskyAtCid`
- `bskyAtRkey`
- `sourceCollection`
- `sourceUri`
- `sourceCollections`
- `canonicalUri`
- `visibility`
- encrypted/gated content cache metadata only when it is not authoritative

If the project has already moved to the creator-owned PDS architecture, these
fields belong on cache/index tables, not authoritative content tables.

### `packages/atproto`

Add typed helpers for standard Bluesky post publishing:

- build and validate `app.bsky.feed.post`
- parse facets for links, mentions, and hashtags
- upload public media blobs to the creator's PDS
- build image/video/embed records supported by Bluesky
- publish the standard post to `app.bsky.feed.post`
- delete the standard post from `app.bsky.feed.post`
- distinguish public cleartext media uploads from encrypted gated media uploads

All writes must use the creator's OAuth session and target `repo:
creator.did`.

### `packages/content`

Change public post write behavior:

1. Validate the input once.
2. Build the standard `app.bsky.feed.post` record.
3. Build the custom `fans.foryour.post` record.
4. Publish both records to the creator's own PDS.
5. Only after both PDS writes succeed, update the local cache/index.

The `fans.foryour.post` record is the canonical foryour.fans record for
fan-service metadata. The `app.bsky.feed.post` record is the canonical Bluesky
interop record for public social distribution. Neither replaces the other.

Failure behavior must be explicit:

- If the Bluesky write fails, do not write the custom record.
- If the custom write fails after the Bluesky write succeeds, attempt to delete
  the Bluesky record and return a `502`.
- If rollback deletion fails, leave a repair job/tombstone marker in local
  state and document the inconsistency.
- Never create a local authoritative post row without the required PDS records.

Updating a public post must update both records. Deleting a public post must
delete/tombstone both records.

Changing visibility:

- non-public to `PUBLIC`: publish both records.
- `PUBLIC` to non-public: delete/tombstone the `app.bsky.feed.post` record and
  replace or update the custom record according to the encrypted/gated PDS
  design. Do not leave formerly public plaintext body/media in a gated custom
  record.
- `PUBLIC` to `PUBLIC`: preserve rkeys where possible and update both records.

### `packages/discovery`

Index both public post models:

- `fans.foryour.post`
- `app.bsky.feed.post`

The index must understand that a single creator-visible public post may have two
AT records. Do not duplicate it in foryour.fans feeds when both records describe
the same authored post.

Add merge/dedupe logic:

- If `fans.foryour.post.bskyUri` points to an `app.bsky.feed.post`, treat them
  as one post in foryour.fans UI.
- If no explicit link exists, dedupe conservatively by same DID, close timestamp,
  and identical normalized text only when that cannot hide distinct posts.
- Preserve the source information so debugging can show whether a feed item came
  from the custom record, the Bluesky record, or both.

### `apps/api`

Update:

- `POST /creators/me/posts`
- `PATCH /creators/me/posts/:id` if implemented
- `DELETE /creators/me/posts/:id`
- `GET /posts/:id`
- `GET /feed`
- `GET /creators/:identifier/feed`
- `GET /creators/:identifier/posts`
- `GET /discover`
- `GET /search`

API responses for public posts must expose:

- app/local id if present
- `foryourAtUri`
- `foryourAtCid`
- `bskyAtUri`
- `bskyAtCid`
- `sourceCollections: ["fans.foryour.post", "app.bsky.feed.post"]` when both
  exist
- `canonicalUri`
- creator DID and handle
- visibility
- display text
- media/embed summary

The home feed and creator feed must show both lexicon post models:

- public posts created on foryour.fans and dual-published to both records
- public Bluesky posts from the same creator when they exist only as
  `app.bsky.feed.post`
- public `fans.foryour.post` records when they exist only as custom records
- unlocked encrypted/gated foryour.fans posts for active paid subscribers
- locked metadata for gated encrypted posts when the caller lacks entitlement,
  without plaintext body/media or decryption keys

The feed must not render duplicates when both records represent the same public
post.

## Web Changes

### Composer

Update the public-post composer:

- Label public posts as publishing to Bluesky-compatible feeds and the
  foryour.fans record.
- Validate Bluesky text/facet/media constraints before submit.
- Show an error if the post cannot fit normal Bluesky rules.
- For public posts, avoid fields that cannot be represented in
  `app.bsky.feed.post` unless they are stored only in the custom record and do
  not make the Bluesky copy misleading.
- If media is attached to a public post, the UI must validate the media against
  Bluesky-compatible public embed constraints and the creator's PDS blob limits.

For gated posts:

- Do not imply they will appear on Bluesky.
- Explain that subscriber-only/tier-gated content is encrypted and not published
  as a normal public Bluesky post.
- Do not reuse the public Bluesky media upload path for gated media unless the
  bytes are encrypted before they reach the PDS and the resulting record is not
  an `app.bsky.feed.post`.

### Feeds

Update the web feed UI so this site can display both post models:

- normal Bluesky posts (`app.bsky.feed.post`)
- foryour.fans public posts (`fans.foryour.post`)
- dual-published posts as one merged card
- gated encrypted posts as locked/unlocked cards depending on entitlement

Cards must show source/status without visual clutter:

- "Public" for plain public posts
- "Bluesky" or a Bluesky-compatible source indicator when useful
- "Subscriber-only" / "Tier" for gated posts
- locked state for inaccessible gated posts

Do not create separate duplicated cards for the Bluesky and foryour records of
the same post.

### Creator Page

The creator page feed tab must include:

- public dual-published posts from foryour.fans
- public Bluesky-only posts by that DID, if the API includes them
- custom-only public posts by that DID
- locked/unlocked gated foryour.fans posts

Sorting must be by authored timestamp, with deterministic tie-breaking by AT URI
or local id.

### Single Post View

`/c/:handle/post/:id` must support resolving by:

- local id
- `fans.foryour.post` AT URI
- `app.bsky.feed.post` AT URI

When both records exist, use the merged/canonical post.

## Tests

Backend tests:

- creating a `PUBLIC` post publishes `app.bsky.feed.post` and
  `fans.foryour.post`
- the custom record links to the Bluesky record where supported
- failed Bluesky publish does not create a custom record or local cache row
- failed custom publish attempts to roll back the Bluesky record
- deleting a public post deletes/tombstones both records
- non-public posts never create `app.bsky.feed.post`
- feed dedupes dual-published records
- feed includes Bluesky-only public posts and custom-only public posts
- API responses include both source URIs/CIDs

Web tests:

- public composer shows Bluesky-compatible publish copy
- public composer validates Bluesky constraints
- gated composer does not claim Bluesky publication
- feed renders dual-published records as one card
- feed renders Bluesky-only and custom-only public posts
- creator page mixes both public post models plus gated cards
- single-post routing can resolve both AT URI families
- gated media UI does not invoke the public Bluesky embed path

## Documentation Updates

Update:

- `README.md`
- `docs/architecture.md`
- `docs/atproto-vs-database.md`
- `docs/creator-owned-pds.md`
- `docs/bluesky-public-posts.md`
- `docs/build-plan.md`
- `prompts/full.md` or a phase tracker note, so future phases assume public
  posts are dual-published
- `prompts/web.md` or a phase tracker note, so future web work assumes feeds can
  render both public post collections

The docs must state plainly:

- public posts are normal Bluesky posts and foryour.fans records
- gated posts are not normal public Bluesky posts
- feeds merge both public post models
- duplicates are intentionally collapsed
- public-media and gated-media upload paths are intentionally different
- creators can still move between compatible fan-service apps because the
  records live in their own PDS

## Exit Checklist

Before marking this refactor complete:

1. `pnpm build`
2. `pnpm lint`
3. `pnpm typecheck`
4. `pnpm test`
5. Docker stack starts cleanly
6. A real or local PDS test shows a public post written as
   `app.bsky.feed.post`
7. The same post is also written as `fans.foryour.post`
8. The foryour.fans feed shows the merged post once
9. A Bluesky-compatible client can view the normal public post
10. Gated encrypted posts never appear as normal public Bluesky posts

**Stop after backend and web support for dual public post models is complete.
Do not proceed to unrelated comments/likes or recommendation work in this
phase.**
