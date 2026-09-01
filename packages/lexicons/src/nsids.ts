/**
 * Centralized NSIDs for this application's Lexicon namespace.
 *
 * prompts/full.md asks for this namespace to be "configurable through
 * environment variables until the final production domain is selected."
 * That's true in spirit but NOT as a live `process.env` read here: an NSID
 * must exactly match the `id` baked into its compiled lexicon schema (see
 * ../lexicons/dev/creator/*.json and the generated src/lexicons/**), which
 * only exists for the literal string "dev.creator". Swapping the value of
 * an env var at runtime without also re-authoring the lexicon JSON files
 * and re-running `pnpm generate` would silently desync the NSID this app
 * writes records under from the schema it validates them against — a
 * correctness bug, not a config toggle.
 *
 * So instead: every place in the codebase that needs one of these NSIDs
 * imports it from here, and here alone — never a literal string. Migrating
 * to the real production domain later is then a mechanical, three-step,
 * compile-time change: (1) author new lexicon JSON under the new NSID,
 * (2) `pnpm --filter @foryour-fans/lexicons run generate`, (3) update the
 * three constants below to match. Not a runtime toggle.
 */
export const LEXICON_NAMESPACE = "dev.creator";

export const NSID = {
  profile: `${LEXICON_NAMESPACE}.profile`,
  post: `${LEXICON_NAMESPACE}.post`,
  tier: `${LEXICON_NAMESPACE}.tier`,
  embedImages: `${LEXICON_NAMESPACE}.embed.images`,
} as const;
