import { BSKY_NSID, NSID } from "@foryour-fans/lexicons";

/**
 * Merge / dedupe the two AT records a single dual-published public post can
 * have (prompts/bluesky-public-posts.md, docs/bluesky-public-posts.md §6):
 * `fans.foryour.post` (fan-service metadata) and `app.bsky.feed.post` (the
 * Bluesky-interop copy). One creator-visible post → one feed item.
 *
 * Two match strategies, most-trusted first:
 *   1. Explicit link — a `fans.foryour.post` row whose `bskyUri` equals an
 *      `app.bsky.feed.post` row's `uri`, same DID.
 *   2. Conservative heuristic — same DID, authored timestamps within
 *      `CLOSE_MS`, identical normalized text. Never merges when text differs,
 *      so it can't hide two genuinely distinct posts.
 * Cross-DID rows are never merged.
 */

const CLOSE_MS = 5000;

export interface IndexedPostRow {
  uri: string;
  did: string;
  collection: string;
  text: string;
  bskyUri: string | null;
  cid: string | null;
  atCreatedAt: Date | null;
  indexedAt: Date;
}

export interface MergedPost {
  /** The record to treat as canonical for display/dedupe. */
  canonicalUri: string;
  did: string;
  text: string;
  atCreatedAt: Date | null;
  /** Which AT collections back this one authored post. */
  sourceCollections: string[];
  foryourUri: string | null;
  bskyUri: string | null;
  /** Where this feed item came from — for debugging/telemetry. */
  source: "custom" | "bsky" | "merged";
}

function normalizeText(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function close(a: Date | null, b: Date | null): boolean {
  if (!a || !b) return false;
  return Math.abs(a.getTime() - b.getTime()) <= CLOSE_MS;
}

function toMerged(custom: IndexedPostRow | null, bsky: IndexedPostRow | null): MergedPost {
  if (custom && bsky) {
    return {
      canonicalUri: custom.uri,
      did: custom.did,
      text: custom.text || bsky.text,
      atCreatedAt: custom.atCreatedAt ?? bsky.atCreatedAt,
      sourceCollections: [NSID.post, BSKY_NSID.feedPost],
      foryourUri: custom.uri,
      bskyUri: bsky.uri,
      source: "merged",
    };
  }
  if (custom) {
    return {
      canonicalUri: custom.uri,
      did: custom.did,
      text: custom.text,
      atCreatedAt: custom.atCreatedAt,
      sourceCollections: [NSID.post],
      foryourUri: custom.uri,
      bskyUri: custom.bskyUri,
      source: "custom",
    };
  }
  const b = bsky!;
  return {
    canonicalUri: b.uri,
    did: b.did,
    text: b.text,
    atCreatedAt: b.atCreatedAt,
    sourceCollections: [BSKY_NSID.feedPost],
    foryourUri: null,
    bskyUri: b.uri,
    source: "bsky",
  };
}

/**
 * Collapses an array of `IndexedPost` rows into one entry per authored post,
 * newest first (by `atCreatedAt`, then `uri`). Rows for collections other
 * than `fans.foryour.post` / `app.bsky.feed.post` are passed through
 * untouched as `source: "custom"`.
 */
export function mergeIndexedPosts(rows: IndexedPostRow[]): MergedPost[] {
  const customs = rows.filter((r) => r.collection === NSID.post);
  const bskys = rows.filter((r) => r.collection === BSKY_NSID.feedPost);
  const consumedBsky = new Set<string>();
  const out: MergedPost[] = [];

  const bskyByUri = new Map(bskys.map((r) => [r.uri, r]));

  for (const custom of customs) {
    let pair: IndexedPostRow | null = null;

    // 1. explicit link
    if (custom.bskyUri) {
      const linked = bskyByUri.get(custom.bskyUri);
      if (linked && linked.did === custom.did && !consumedBsky.has(linked.uri)) {
        pair = linked;
      }
    }

    // 2. conservative heuristic
    if (!pair) {
      pair =
        bskys.find(
          (b) =>
            !consumedBsky.has(b.uri) &&
            b.did === custom.did &&
            normalizeText(b.text) === normalizeText(custom.text) &&
            close(b.atCreatedAt, custom.atCreatedAt),
        ) ?? null;
    }

    if (pair) consumedBsky.add(pair.uri);
    out.push(toMerged(custom, pair));
  }

  for (const bsky of bskys) {
    if (consumedBsky.has(bsky.uri)) continue;
    out.push(toMerged(null, bsky));
  }

  // Any other collection: pass through.
  for (const row of rows) {
    if (row.collection === NSID.post || row.collection === BSKY_NSID.feedPost) continue;
    out.push({
      canonicalUri: row.uri,
      did: row.did,
      text: row.text,
      atCreatedAt: row.atCreatedAt,
      sourceCollections: [row.collection],
      foryourUri: null,
      bskyUri: null,
      source: "custom",
    });
  }

  out.sort((a, b) => {
    const at = a.atCreatedAt?.getTime() ?? 0;
    const bt = b.atCreatedAt?.getTime() ?? 0;
    if (at !== bt) return bt - at;
    return a.canonicalUri < b.canonicalUri ? 1 : -1;
  });
  return out;
}
