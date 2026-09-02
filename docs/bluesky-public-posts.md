# Bluesky-compatible public posts — research

This is the "Required Research Before Implementation" output of
[`prompts/bluesky-public-posts.md`](../prompts/bluesky-public-posts.md). It pins the
`app.bsky.feed.post` field / facet / embed rules the dual-publish implementation is
built against, so the code targets the production Bluesky network rather than stale
memory.

Every claim is tagged:

- **[SPEC]** — stated in an atproto / Bluesky lexicon or reference implementation.
- **[OBSERVED]** — checked against a live PDS / AppView / the vendored lexicon JSON
  during this research.
- **[ASSUMPTION]** — a design assumption not guaranteed by the protocol; re-verify
  before it becomes load-bearing.

Research date: 2026-09-02. Primary sources are the lexicon JSON files in the
`bluesky-social/atproto` repo (`main`), vendored into
`packages/lexicons/lexicons/app/bsky/**` and pinned in `packages/lexicons/lexicons.json`.

---

## 0. What the creator-owned-PDS proof-of-concept already assumed

The creator-owned-PDS backend PoC (see [`docs/creator-owned-pds.md`](./creator-owned-pds.md))
already dual-publishes public posts, with the **minimum** it could justify without this
research:

- A public post writes **two** records to the creator's own PDS:
  `app.bsky.feed.post` (rkey `tid`) and `fans.foryour.post` (rkey `tid`).
- The `app.bsky.feed.post` body was minimal: `{ $type, text, createdAt }`.
- Linkage lives on the `fans.foryour.post` record: `bskyUri`, `bskyCid`,
  `canonicalUri` (this record's own URI), `sourceApp`.
- The local cache row (`Post`) stores `sourceUri`/`sourceCid` (the `fans.foryour.post`)
  and `bskyUri`/`bskyCid` (the paired Bluesky post).
- A gated (`SUBSCRIBERS`/`TIER`) post is **never** written as `app.bsky.feed.post`.
- On delete, both records are retracted.

This phase keeps all of that and replaces the placeholder Bluesky body with a
lexicon-accurate one (facets, `langs`, `tags`, embeds), adds `packages/discovery`
merge/dedupe, and adds the web composer / feed / single-post surfaces.

Dual-publish remains gated behind `CREATOR_OWNED_PDS_ENABLED` (default off, paused for
privacy review) — this phase hardens that path, it does not turn it on by default.

---

## 1. `app.bsky.feed.post` record

**[SPEC]** `lexicon: 1`, `id: app.bsky.feed.post`, `type: record`, `key: tid`.

### Required fields

| Field | Type | Rule |
|---|---|---|
| `text` | string | `maxLength: 3000` (UTF-8 **bytes**), `maxGraphemes: 300`. May be `""` when the post is only an embed. |
| `createdAt` | string | `format: datetime` (RFC-3339 / ISO-8601). Client-declared. |

### Optional fields

| Field | Type | Rule |
|---|---|---|
| `facets` | array of `app.bsky.richtext.facet` | Rich-text annotations (links, mentions, tags). See §2. |
| `reply` | `#replyRef` | `{ root: com.atproto.repo.strongRef, parent: com.atproto.repo.strongRef }`. **Not used** by this phase — a foryour.fans public post is always a top-level post. |
| `embed` | union | One of `app.bsky.embed.images`, `app.bsky.embed.video`, `app.bsky.embed.external`, `app.bsky.embed.record`, `app.bsky.embed.recordWithMedia`. See §3. |
| `langs` | array of string (BCP-47) | `maxLength: 3`. |
| `labels` | union of `com.atproto.label.defs#selfLabels` | Self-applied content-warning labels — the same union `fans.foryour.post.labels` already references. |
| `tags` | array of string | `maxLength: 8`; each `maxLength: 640` / `maxGraphemes: 64`. Hashtags **without** the leading `#`. Additive to `#`-tags that also appear as `facets`. |
| `entities` | array | **Deprecated.** Superseded by `facets`. Do not write it. |

**[OBSERVED]** The vendored `packages/lexicons/lexicons/app/bsky/feed/post.json` matches
the table above.

### What this phase writes

`buildBskyPostRecord` (`packages/atproto/src/bskyPost.ts`) produces:

```jsonc
{
  "$type": "app.bsky.feed.post",
  "text": "<cleartext, ≤ 300 graphemes / 3000 bytes>",
  "createdAt": "<ISO-8601>",
  "facets": [ /* parsed links / mentions / #tags, when any */ ],
  "langs": [ /* ≤ 3, when supplied */ ],
  "tags": [ /* ≤ 8, when supplied */ ],
  "labels": { /* selfLabels, when the fans.foryour.post has content warnings */ },
  "embed": { /* app.bsky.embed.images | external, when media is attached — DEFERRED, see §3 */ }
}
```

It never writes `reply`, `entities`, or `embed.record*`.

---

## 2. Facets — `app.bsky.richtext.facet`

**[SPEC]** Structure:

```jsonc
{
  "index": { "byteStart": <int ≥ 0>, "byteEnd": <int ≥ 0> },   // byteSlice
  "features": [ /* one or more of the union below */ ]
}
```

- **[SPEC]** `index.byteStart` / `byteEnd` count **bytes of the UTF-8-encoded `text`**,
  zero-indexed, `byteStart` inclusive, `byteEnd` exclusive. This is why the composer's
  character counter (graphemes) and the facet math (bytes) are computed separately.
- **[SPEC]** `features` union members:
  - `app.bsky.richtext.facet#mention` — `{ did: <DID> }`. The `@handle` in the text is
    display-only; the record stores the resolved DID.
  - `app.bsky.richtext.facet#link` — `{ uri: <URI> }`. The full URL even when the
    display text is shortened.
  - `app.bsky.richtext.facet#tag` — `{ tag: <string> }`, `maxLength: 640`,
    `maxGraphemes: 64`, **no** leading `#`.

### How this phase builds them

`parseFacets(text, { resolveHandle })` in `packages/atproto/src/bskyPost.ts`:

1. **Links** — match `https?://…` and bare-domain URLs using the same shape Bluesky's
   official `RichText` detection uses (a domain with a known TLD, optional path, trailing
   punctuation trimmed). Emit a `#link` feature with the normalized `uri` (prefix
   `https://` when the match was bare).
2. **Mentions** — match `@<handle>` where `<handle>` is a valid handle
   (`[a-zA-Z0-9.-]+` with at least one dot). Resolve via the injected `resolveHandle`
   (`packages/atproto/src/identity.ts`). **Unresolvable handles are dropped** (no facet,
   the `@text` stays as plain text) rather than failing the post.
3. **Tags** — match `#<tag>` (`\S+`, stop at whitespace/punctuation), strip the `#`,
   drop tags longer than 64 graphemes, cap at 8.
4. All offsets are computed with `Buffer.byteLength(textBefore, "utf8")` so multi-byte
   characters (emoji, CJK) produce correct `byteStart`/`byteEnd`.

**[ASSUMPTION]** The link/mention regexes approximate — not byte-for-byte reproduce —
Bluesky's `@atproto/api` `RichText.detectFacets`. Good enough for the common cases a
creator composer produces; a post with an unusual URL may render as plain text in a
Bluesky client rather than a link. Acceptable, and documented in the composer copy
("links and @mentions are detected automatically").

---

## 3. Embeds and blob constraints

All from the vendored `packages/lexicons/lexicons/app/bsky/embed/*.json`.

### `app.bsky.embed.images` — **[SPEC]**

- `images`: array, `maxLength: 4`.
- Each item: `{ image: blob, alt: string (required), aspectRatio?: {width,height} }`.
- `image` blob: `accept: ["image/*"]`, `maxSize: 2_000_000` bytes
  ("May be up to 2 MB, formerly limited to 1 MB").
- `alt` is **required** on every image (accessibility).

### `app.bsky.embed.external` — **[SPEC]**

- `external`: `{ uri, title, description, thumb?: blob }`.
- `thumb` blob: `accept: ["image/*"]`, `maxSize: 1_000_000` bytes.

### `app.bsky.embed.video` — **[SPEC]**

- `video` blob: `accept: ["video/mp4"]`, `maxSize: 300_000_000` bytes.
- `captions`: `maxLength: 20`, each `{ lang, file: blob (accept ["text/vtt"], maxSize 20_000) }`.
- `alt?`, `aspectRatio?`.

### `app.bsky.embed.defs#aspectRatio` — **[SPEC]**

`{ width: int ≥ 1, height: int ≥ 1 }`. Approximate; not absolute units.

### What this phase does with media

**Deferred.** Per [`docs/creator-owned-pds.md`](./creator-owned-pds.md) §9, moving media
**bytes** off app-owned S3 onto the creator's PDS as `fans.foryour.media` blobs is the
implementation phase's job, not this one. So:

- `packages/atproto/src/bskyPost.ts` ships `buildImagesEmbed(uploaded[])` /
  `buildExternalEmbed(card)` — pure builders that turn **already-uploaded** blob refs
  into a valid `embed` — and `assertPublicImage({ mimeType, size })` /
  `assertPublicThumb(...)` validators enforcing the accept/maxSize rules above.
- Nothing calls them yet: the composer is **text-only** this phase. The builders and
  validators exist so the media phase is additive, and so the constraints are pinned
  here rather than rediscovered later.
- `fans.foryour.embed.images` (the custom mirror) already exists with the same shape and
  a stricter `accept` (`png`/`jpeg`/`webp`) and `maxSize: 4_000_000`. When media lands,
  the public path validates against the **intersection** (Bluesky's 2 MB image ceiling
  wins).

---

## 4. Custom ↔ Bluesky record linkage

**[OBSERVED]** `com.atproto.repo.getRecord` / `listRecords` are unauthenticated for
public collections, so any consumer with the creator's DID can read both records and
relate them.

### Linkage stored

- `fans.foryour.post` carries `bskyUri` (AT URI of the paired `app.bsky.feed.post`),
  `bskyCid` (its CID at publish time), `canonicalUri` (which record is canonical for
  display/dedupe — this phase always sets it to the `fans.foryour.post`'s own URI),
  `sourceApp` (`"foryour.fans"`), and now `langs`/`tags` mirrored from the Bluesky copy.
- The `app.bsky.feed.post` carries **no backlink** to the `fans.foryour.post`. Decision
  and rationale below.
- The local `Post` cache row stores `sourceUri`/`sourceCid` (custom), `bskyUri`/`bskyCid`
  (Bluesky), `atRkey` (custom rkey, reused across edits), `bskyRkey` (Bluesky rkey,
  reused across edits), `canonicalUri`.

### Why no backlink on the `app.bsky.feed.post` — **[decision]**

The prompt requires the normal Bluesky post to "be readable and useful on its own" and
not look "like an opaque app notification." There is no place to put a
`fans.foryour.post` reference that a generic Bluesky client would ignore gracefully:

- A trailing `also on foryour.fans: <url>` line or link facet **degrades the reading
  experience** for every Bluesky viewer and consumes the 300-grapheme budget.
- `app.bsky.feed.post` has no open/extension field for app-private metadata; unknown
  top-level keys are permitted by the (open) record format but are invisible to every
  AppView and carry no defined semantics — not a reliable link, and a maintenance
  hazard if Bluesky later assigns that key.
- The relationship is already fully recoverable from the **custom** side
  (`fans.foryour.post.bskyUri`), which is where fan-service-aware consumers look.

So the direction is one-way: custom → Bluesky. `packages/discovery`'s merge rule (§6)
relies only on that.

### Gated content never gets an `app.bsky.feed.post` — **[SPEC of this phase]**

A `SUBSCRIBERS` / `TIER` post is never dual-published. No teaser `app.bsky.feed.post` is
auto-created from gated content. A gated `fans.foryour.post` carries only
`visibility`, an `accessPolicy` ref, and `encryptedBody` (no plaintext `text`, no key
material) — see `docs/creator-owned-pds.md` §4/§7. If a creator wants a public teaser
for gated content, that is a separate, explicitly-authored **public** post.

---

## 5. Deletion

**[SPEC]** Deleting a public post issues `com.atproto.repo.deleteRecord` for **both**
records (`app.bsky.feed.post` then `fans.foryour.post`, or either order — they are
independent). Consequences, identical to `docs/creator-owned-pds.md` §1/§6:

- The MST no longer contains either path; there is **no in-repo tombstone**.
- A `#delete` commit fires on the PDS firehose for each; relays / AppViews / this app's
  `packages/discovery` ingestor remove their indexed rows, but already-propagated copies
  elsewhere are **best-effort**, not guaranteed erasure.
- Blob GC (if media had been attached) is best-effort on last-unreference.

**[OBSERVED]** Whether `deleteRecord` of an already-absent record errors on a real PDS
was **not** verified (same open question `packages/atproto/src/records.ts#deleteRecord`
already documents). `CreatorOwnedContentRepository.retractPdsRecords` therefore only
issues deletes for records it has a stored rkey for, and a rollback delete swallows its
error (`.catch(() => undefined)`), so a double-delete or a delete-of-missing never
wedges the flow.

### Rollback on a half-published pair

- `app.bsky.feed.post` publish fails → stop; no `fans.foryour.post`, no `Post` row.
- `fans.foryour.post` publish fails → delete the `app.bsky.feed.post` just written; if
  **that** delete also fails, log an error identifying the orphaned
  `at://<did>/app.bsky.feed.post/<rkey>` and still create **no** `Post` row. The route
  returns `502`. A periodic repair job that reconciles orphaned Bluesky records against
  the absence of a paired custom record is **future work** (noted here, not built —
  matches the PoC's existing tolerance for this window).

---

## 6. Indexing and merge/dedupe

**[SPEC]** A normal Bluesky feed / AppView indexes the `app.bsky.feed.post` like any
other post — it appears in the author's profile feed, in follower timelines, in search,
in embeds, and in third-party AppViews. It has no idea the `fans.foryour.post` exists.

`fans.foryour.post` is indexed only by fan-service-aware consumers. This app's
`packages/discovery` ingests both collections (the Bluesky one behind `INDEX_BSKY_POSTS`,
default off, DID-scoped when on — see below) into `IndexedPost` rows tagged with
`collection`.

### Merge rule — **[SPEC of this phase]**

`mergeIndexedPosts(rows)` (`packages/discovery/src/merge.ts`) collapses a
creator-visible public post that has two AT records into **one** item:

1. **Explicit link.** A `fans.foryour.post` row whose `bskyUri` matches an
   `app.bsky.feed.post` row **by the same DID** → one item. `sourceCollections =
   ["fans.foryour.post", "app.bsky.feed.post"]`, `canonicalUri =` the custom URI,
   `source = "merged"`.
2. **No explicit link** (e.g. only the Bluesky record was ingested) → dedupe
   **conservatively**: same DID **and** authored timestamps within 5 s **and** identical
   normalized text (trimmed, collapsed whitespace) → merge. Any text difference → keep
   both. This never hides two genuinely distinct posts, at the cost of occasionally
   showing a dual-published pair twice if the custom record hasn't been ingested yet.
3. Cross-DID rows are never merged.

Each merged/kept result carries `source: "custom" | "bsky" | "merged"` so
debugging/telemetry can show where a feed item came from.

### `INDEX_BSKY_POSTS` — **[decision]**

`wantedCollections` on Jetstream only filters `commit` events by collection, not by DID.
Subscribing to `app.bsky.feed.post` network-wide would mean ingesting the entire
Bluesky firehose to catch the tiny fraction authored by DIDs this app knows — the same
unbounded cost Phase 10 refused for `identity` events. So:

- `INDEX_BSKY_POSTS` (default `false`) gates adding `app.bsky.feed.post` to
  `wantedCollections`.
- When on, `applyCommitEvent` still **filters** `app.bsky.feed.post` events to DIDs that
  already have an `IndexedCreatorProfile` or a local `Creator` row before writing an
  `IndexedPost`.
- A future `wantedDids`-scoped subscription would let this be on by default; noted as a
  known limitation, same shape as the Phase 10 `identity`-event note.

The local `GET /feed` / `GET /creators/:id/feed` routes read the `Post` table, which has
exactly **one** row per authored post, so they cannot produce a duplicate regardless of
`INDEX_BSKY_POSTS`. The merge logic matters for a future indexed/network feed and for
the creator page when it surfaces Bluesky-only posts.

---

## 7. Open questions / re-verify before production

1. **Live render.** This research was done against the vendored lexicon JSON and the
   `@atproto/api` types, not by publishing to `bsky.social` and viewing the result in
   the Bluesky app (no interactive OAuth login is automatable here — same limitation
   every prior phase documented). Before the flag is turned on in a real environment,
   publish one real post and confirm it renders with working links/mentions.
2. **Facet fidelity.** Re-check `parseFacets` against `@atproto/api`'s
   `RichText.detectFacets` on a corpus of real creator text; tighten the regexes if
   link/mention detection diverges.
3. **`deleteRecord` semantics** on the target PDS for an already-absent record (carried
   over from `records.ts`).
4. **Blob ceilings** on a creator's self-hosted PDS may differ from Bluesky's reference
   PDS — validate against `com.atproto.server.describeServer` when the media phase runs.
5. **Backlink revisited** if atproto ever ratifies an app-private-metadata extension
   point on `app.bsky.feed.post`.
