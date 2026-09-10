# Vendored Bluesky lexicons (reference / pinning only)

These JSON files are **verbatim copies** of the production `app.bsky.*` lexicons this
app's public-post dual-publish targets, plus (as of Phase 14) `app.bsky.graph.block`,
reused for portable user-to-user blocking. Source:

- Repo: <https://github.com/bluesky-social/atproto>
- Path: `lexicons/app/bsky/**`
- Ref: `main` @ 2026-09-02 for the feed/embed/richtext set (see `docs/bluesky-public-posts.md`
  for the research pass that pinned those); `main` @ 2026-09-07 for `graph/block.json`
  (see `docs/architecture.md`'s Phase 14 section — the file is unchanged upstream since
  Bluesky open-sourced it, so this is the same content, just a later verification date).

## Why they live here and not in `../lexicons/`

`../lexicons/` is scanned by `lex build` (`pnpm --filter @foryour-fans/lexicons generate`)
to produce local TypeScript. We deliberately do **not** codegen the `app.bsky.*` set:

- We author `app.bsky.feed.post` records via hand-written builders + a zod validator in
  `packages/atproto/src/bskyPost.ts`, mirroring the field rules recorded in
  `docs/bluesky-public-posts.md`. That avoids a `lex install` network dependency and the
  transitive-ref closure (`com.atproto.repo.strongRef`, `app.bsky.embed.record`, …) that
  full codegen would drag in.
- `app.bsky.graph.block` is handled the same way, by `packages/atproto/src/bskyBlock.ts`
  — see its doc comment and `docs/architecture.md`'s Phase 14 section for why blocking
  reuses this real, standard record type instead of an app-private one.
- These files are the **pinned reference** the validators are checked against
  (`packages/atproto/src/bskyPost.test.ts` and `packages/atproto/src/bskyBlock.test.ts`
  assert agreement).

Re-vendor from the same repo path if Bluesky changes a lexicon; then re-run the
corresponding test file and update `docs/bluesky-public-posts.md` (feed/embed/richtext)
or `docs/architecture.md` (graph/block).

## Not part of our Lexicon authority

The Lexicon-authority phase (`docs/lexicon-authority.md`) makes `foryour.fans` the
DNS-verifiable authority for the **`fans.foryour.*`** namespace only. These vendored
`app.bsky.*` / `com.atproto.*` files are **not** published by that authority and never
appear in its signed schema repo — Bluesky (`_lexicon.bsky.app`) and the AT Protocol
project are their authorities, and resolving those NSIDs is their job, not ours.
