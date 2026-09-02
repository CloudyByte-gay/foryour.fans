/**
 * Centralized NSIDs for this application's Lexicon namespace.
 *
 * The production domain is foryour.fans, so per AT Protocol's reverse-DNS
 * NSID convention (e.g. bsky.app -> app.bsky.*), the authority is
 * "fans.foryour" — see ../lexicons/fans/foryour/*.json and the generated
 * src/lexicons/**. This was originally the placeholder "dev.creator" before
 * the domain was chosen (see prompts/full.md's Phase 3 note); since no real
 * record was ever published under that placeholder, switching directly to
 * the permanent namespace was a same-day rename, not a migration.
 *
 * These are compile-time constants, not a live `process.env` read: an NSID
 * must exactly match the `id` baked into its compiled lexicon schema.
 * Reading a namespace from the environment at runtime would let it drift
 * from the schema actually compiled in, which is a correctness bug (writing
 * records under one NSID while validating against another), not a useful
 * config toggle. Every place in the codebase that needs one of these NSIDs
 * imports it from here, and here alone — never a literal string.
 */
export const LEXICON_NAMESPACE = "fans.foryour";

export const NSID = {
  profile: `${LEXICON_NAMESPACE}.profile`,
  post: `${LEXICON_NAMESPACE}.post`,
  tier: `${LEXICON_NAMESPACE}.tier`,
  media: `${LEXICON_NAMESPACE}.media`,
  accessPolicy: `${LEXICON_NAMESPACE}.accessPolicy`,
  serviceConfig: `${LEXICON_NAMESPACE}.serviceConfig`,
  embedImages: `${LEXICON_NAMESPACE}.embed.images`,
} as const;

/**
 * Bluesky's own NSIDs, used by the public-post dual-publish path
 * (prompts/bluesky-public-posts.md, docs/bluesky-public-posts.md). Every
 * PUBLIC fans.foryour.post is paired with an app.bsky.feed.post so Bluesky
 * and Bluesky-compatible clients render it. The lexicon JSON is vendored
 * (reference/pinning only, NOT codegen'd) under
 * packages/lexicons/vendor/app/bsky/** — records are built and validated by
 * hand-written helpers in packages/atproto/src/bskyPost.ts.
 */
export const BSKY_NSID = {
  feedPost: "app.bsky.feed.post",
  richtextFacet: "app.bsky.richtext.facet",
  embedImages: "app.bsky.embed.images",
  embedExternal: "app.bsky.embed.external",
  embedVideo: "app.bsky.embed.video",
} as const;
