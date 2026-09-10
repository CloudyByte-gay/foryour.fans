import { BSKY_NSID, NSID } from "@foryour-fans/lexicons";
import { parseAtUri } from "./bskyPost.js";

/**
 * Build / validate the two "like" records this app writes to a LIKER's own
 * PDS when `CREATOR_OWNED_PDS_ENABLED` is on:
 *
 * - `fans.foryour.like` — always, for a like on any post that has a canonical
 *   `fans.foryour.post` record. Portable; rides the open AT network the same
 *   way `app.bsky.feed.like` does.
 * - `app.bsky.feed.like` — additionally, only for a like on a PUBLIC post
 *   (which is itself dual-published as an `app.bsky.feed.post`), so Bluesky's
 *   own AppView counts it. Never written for a gated post — same rule as the
 *   post dual-publish (see packages/content/src/creatorOwnedRepository.ts).
 *
 * Both records are structurally identical: a `com.atproto.repo.strongRef`
 * subject (`{uri, cid}`) plus `createdAt`. Unlike = delete the record(s).
 *
 * Hand-written against the vendored/authored lexicon JSON rather than
 * codegen'd, same discipline as ./bskyPost.ts and ./bskyBlock.ts — trivial
 * records, and it keeps the `com.atproto.repo.strongRef` ref closure out of
 * `lex build`. Kept in sync with:
 *   - packages/lexicons/lexicons/fans/foryour/like.json  (fans.foryour.like)
 *   - packages/lexicons/vendor/app/bsky/feed/like.json   (app.bsky.feed.like)
 * by packages/atproto/src/like.test.ts.
 *
 * Match a like to its subject post by `subject.uri` ONLY. A post edit
 * republishes `fans.foryour.post` under the same rkey with a fresh CID, so an
 * older like's `subject.cid` is a point-in-time integrity anchor, not a join
 * key — exactly as it is for `app.bsky.feed.like` on Bluesky.
 */

export interface StrongRef {
  uri: string;
  cid: string;
}

export class LikeValidationError extends Error {}

export interface BuildLikeInput {
  /** Strong reference to the post being liked. */
  subject: StrongRef;
  createdAt?: Date | string;
}

export type ForyourLikeRecord = {
  $type: "fans.foryour.like";
  subject: StrongRef;
  createdAt: string;
};

export type BskyLikeRecord = {
  $type: "app.bsky.feed.like";
  subject: StrongRef;
  createdAt: string;
};

function normalizeStrongRef(subject: StrongRef, label: string): StrongRef {
  if (typeof subject !== "object" || subject === null) {
    throw new LikeValidationError(`${label} \`subject\` must be an object.`);
  }
  if (typeof subject.uri !== "string" || parseAtUri(subject.uri) === null) {
    throw new LikeValidationError(`${label} \`subject.uri\` must be an at:// URI.`);
  }
  if (typeof subject.cid !== "string" || subject.cid.length === 0) {
    throw new LikeValidationError(`${label} \`subject.cid\` is required (strong ref, not a bare URI).`);
  }
  return { uri: subject.uri, cid: subject.cid };
}

function toIso(createdAt: BuildLikeInput["createdAt"]): string {
  if (typeof createdAt === "string") return createdAt;
  return (createdAt ?? new Date()).toISOString();
}

/** Assemble a valid `fans.foryour.like`. Throws `LikeValidationError` on a malformed subject. */
export function buildForyourLikeRecord(input: BuildLikeInput): ForyourLikeRecord {
  return {
    $type: NSID.like,
    subject: normalizeStrongRef(input.subject, "fans.foryour.like"),
    createdAt: toIso(input.createdAt),
  };
}

/** Assemble a valid `app.bsky.feed.like`. Throws `LikeValidationError` on a malformed subject. */
export function buildBskyLikeRecord(input: BuildLikeInput): BskyLikeRecord {
  return {
    $type: BSKY_NSID.feedLike,
    subject: normalizeStrongRef(input.subject, "app.bsky.feed.like"),
    createdAt: toIso(input.createdAt),
  };
}

function assertLikeShape(record: unknown, expectedType: string): asserts record is { subject: StrongRef; createdAt: string } {
  if (typeof record !== "object" || record === null) {
    throw new LikeValidationError("Record must be an object.");
  }
  const r = record as Record<string, unknown>;
  if (r.$type !== expectedType) {
    throw new LikeValidationError(`Wrong $type: ${String(r.$type)} (expected ${expectedType}).`);
  }
  normalizeStrongRef(r.subject as StrongRef, expectedType);
  if (typeof r.createdAt !== "string" || Number.isNaN(Date.parse(r.createdAt))) {
    throw new LikeValidationError("`createdAt` is required and must be an ISO-8601 datetime.");
  }
}

/**
 * Structural check that a value is a lexicon-valid `fans.foryour.like`.
 * Mirrors packages/lexicons/lexicons/fans/foryour/like.json.
 */
export function validateForyourLikeRecord(record: unknown): asserts record is ForyourLikeRecord {
  assertLikeShape(record, NSID.like);
}

/**
 * Structural check that a value is a lexicon-valid `app.bsky.feed.like`.
 * Mirrors packages/lexicons/vendor/app/bsky/feed/like.json (the optional
 * `via` field is allowed to round-trip but this app never sets it).
 */
export function validateBskyLikeRecord(record: unknown): asserts record is BskyLikeRecord {
  assertLikeShape(record, BSKY_NSID.feedLike);
}
