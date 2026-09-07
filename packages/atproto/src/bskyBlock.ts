import { BSKY_NSID } from "@foryour-fans/lexicons";

/**
 * Build / validate `app.bsky.graph.block` records — Phase 14 (Trust and
 * Safety). Reused, not reinvented: `app.bsky.graph.block` is the real,
 * standard AT Protocol record every Bluesky-compatible client (including
 * Bluesky's own AppView) already reads to filter blocked accounts out of
 * feeds, replies, and mentions. Writing a real block record here instead of
 * an app-private "UserBlock" flag means:
 *
 * - A block a subscriber makes on foryour.fans also takes effect on
 *   Bluesky (and any other AT client) for a dual-published PUBLIC post,
 *   with zero extra integration work — it's the same record.
 * - "Keep things portable" (see docs/architecture.md's Phase 14 section):
 *   a creator or subscriber who leaves foryour.fans takes their block list
 *   with them, because it was never ours to begin with — it lives on
 *   their own PDS, like every other AT record this app writes on a user's
 *   behalf.
 *
 * Hand-written against the vendored lexicon JSON
 * (packages/lexicons/vendor/app/bsky/graph/block.json) rather than
 * codegen'd, same discipline as ./bskyPost.ts — this record is trivial
 * (two fields) so hand-writing avoids a `lex install` dependency for no
 * real benefit.
 *
 * `UserBlock` (packages/moderation) mints one `nextTid()` rkey per block
 * (see packages/atproto/src/injection.ts#nextTid), publishes this record,
 * and caches `uri`/`cid`/`rkey` on the local row — the same
 * mint-once/reuse-rkey/retract-on-unblock discipline Phase 5 established
 * for subscription tiers. This app never reads OTHER accounts' block
 * records over the network (no Jetstream ingestion of `app.bsky.graph.block`
 * is built here) — see docs/architecture.md's Phase 14 section for that
 * documented, deliberate gap.
 */

export class BskyBlockValidationError extends Error {}

export interface BuildBskyBlockInput {
  /** DID of the account being blocked. */
  subjectDid: string;
  createdAt?: Date | string;
}

export type BskyBlockRecord = {
  $type: "app.bsky.graph.block";
  subject: string;
  createdAt: string;
};

const DID_RE = /^did:[a-z0-9]+:[a-zA-Z0-9._:%-]+$/;

/** Assembles a valid `app.bsky.graph.block`. Throws on a malformed subject DID. */
export function buildBskyBlockRecord(input: BuildBskyBlockInput): BskyBlockRecord {
  if (!DID_RE.test(input.subjectDid)) {
    throw new BskyBlockValidationError(`Not a DID: ${input.subjectDid}`);
  }
  return {
    $type: "app.bsky.graph.block",
    subject: input.subjectDid,
    createdAt: typeof input.createdAt === "string" ? input.createdAt : (input.createdAt ?? new Date()).toISOString(),
  };
}

/**
 * Structural check that a value is a lexicon-valid `app.bsky.graph.block`.
 * Mirrors the vendored `packages/lexicons/vendor/app/bsky/graph/block.json`
 * — kept in sync by packages/atproto/src/bskyBlock.test.ts.
 */
export function validateBskyBlockRecord(record: unknown): asserts record is BskyBlockRecord {
  if (typeof record !== "object" || record === null) {
    throw new BskyBlockValidationError("Record must be an object.");
  }
  const r = record as Record<string, unknown>;
  if (r.$type !== BSKY_NSID.graphBlock) {
    throw new BskyBlockValidationError(`Wrong $type: ${String(r.$type)}`);
  }
  if (typeof r.subject !== "string" || !DID_RE.test(r.subject)) {
    throw new BskyBlockValidationError("`subject` is required and must be a DID.");
  }
  if (typeof r.createdAt !== "string" || Number.isNaN(Date.parse(r.createdAt))) {
    throw new BskyBlockValidationError("`createdAt` is required and must be an ISO-8601 datetime.");
  }
}
