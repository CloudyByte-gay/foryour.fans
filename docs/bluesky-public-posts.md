# Bluesky-compatible public posts — research (STUB)

> **Status: stub.** This document is the "Required Research Before
> Implementation" output of
> [`prompts/bluesky-public-posts.md`](../prompts/bluesky-public-posts.md),
> which has **not run yet**. It exists so forward references from
> [`docs/creator-owned-pds.md`](./creator-owned-pds.md),
> [`docs/architecture.md`](./architecture.md) and the prompt files resolve.
> Fill it in when that phase runs.

## What the creator-owned-PDS proof-of-concept already assumes

The creator-owned-PDS backend PoC (see `docs/creator-owned-pds.md`) already
dual-publishes public posts, using the **minimum** it can justify without this
research:

- A public post writes **two** records to the creator's own PDS:
  `app.bsky.feed.post` (rkey `tid`) and `fans.foryour.post` (rkey `tid`).
- The `app.bsky.feed.post` body the PoC writes is minimal:
  `{ $type: "app.bsky.feed.post", text, createdAt }`.
- Linkage lives on the `fans.foryour.post` record:
  `bskyUri`, `bskyCid`, `canonicalUri` (this record's own URI), `sourceApp`.
- The local cache row (`Post`) stores `sourceUri`/`sourceCid` (the
  `fans.foryour.post`) and `bskyUri`/`bskyCid` (the paired Bluesky post).
- A gated (`SUBSCRIBERS`/`TIER`) post is **never** written as
  `app.bsky.feed.post`.
- On delete, both records are retracted.

## What this phase must still pin down

- `app.bsky.feed.post` required/optional fields as served by the production
  Bluesky lexicon; text length + grapheme limits; `langs`, `reply`, `embed`.
- Facet shape for links / mentions / hashtags, and how the composer builds
  them.
- Image / video / external-embed record shapes and blob constraints on a
  real PDS.
- Whether an `app.bsky.feed.post` can/should carry a backlink to the
  `fans.foryour.post` without degrading the normal Bluesky reading
  experience.
- Deletion + indexing behaviour when both records exist; relay/AppView
  propagation.
- `packages/discovery` merge/dedupe rules for the pair (same DID + linked
  URI ⇒ one feed item).

Until then, treat the PoC's minimal Bluesky body as a placeholder, not a
finished implementation.
