# Vendored Bluesky lexicons (reference / pinning only)

These JSON files are **verbatim copies** of the production `app.bsky.*` lexicons this
app's public-post dual-publish targets. Source:

- Repo: <https://github.com/bluesky-social/atproto>
- Path: `lexicons/app/bsky/**`
- Ref: `main` @ 2026-09-02 (see `docs/bluesky-public-posts.md` for the research pass
  that pinned these)

## Why they live here and not in `../lexicons/`

`../lexicons/` is scanned by `lex build` (`pnpm --filter @foryour-fans/lexicons generate`)
to produce local TypeScript. We deliberately do **not** codegen the `app.bsky.*` set:

- We author `app.bsky.feed.post` records via hand-written builders + a zod validator in
  `packages/atproto/src/bskyPost.ts`, mirroring the field rules recorded in
  `docs/bluesky-public-posts.md`. That avoids a `lex install` network dependency and the
  transitive-ref closure (`com.atproto.repo.strongRef`, `app.bsky.embed.record`, …) that
  full codegen would drag in.
- These files are the **pinned reference** the validator is checked against
  (`packages/atproto/src/bskyPost.test.ts` asserts the two agree).

Re-vendor from the same repo path if Bluesky changes the lexicon; then re-run the
`bskyPost` tests and update `docs/bluesky-public-posts.md`.
