export * from "./nsids.js";

// Lexicon authority manifest + `com.atproto.lexicon.schema` record builder —
// makes the fans.foryour.* schemas resolvable on the open AT network. Pure and
// dependency-light; the signed-repo/CAR machinery is in ./authorityRepo.ts and
// is deliberately NOT re-exported here (it pulls in @atproto/repo and is only
// for the publish tooling + tests). See docs/lexicon-authority.md.
export * from "./authority.js";

// Generated from ./lexicons/**/*.json by `pnpm generate` (see package.json) —
// not committed, not hand-edited. Re-exported here so consumers depend on
// @foryour-fans/lexicons, not this package's internal src/lexicons layout.
export * as atLexicons from "./lexicons/index.js";
