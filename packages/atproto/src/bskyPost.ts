import { BSKY_NSID } from "@foryour-fans/lexicons";

/**
 * Build / validate `app.bsky.feed.post` records and parse rich-text facets,
 * so every PUBLIC foryour.fans post is dual-published as a normal Bluesky
 * post (prompts/bluesky-public-posts.md, docs/bluesky-public-posts.md).
 *
 * Hand-written against the vendored lexicon JSON
 * (packages/lexicons/vendor/app/bsky/**) rather than codegen'd — see that
 * dir's SOURCES.md. DI-friendly (no Agent/NodeOAuthClient import), same
 * discipline as ./injection.ts: `parseFacets` takes a handle resolver so
 * this module never reaches for the network itself.
 */

// --- Limits (from the vendored lexicon; docs/bluesky-public-posts.md §1/§3) ---
export const BSKY_POST_MAX_GRAPHEMES = 300;
export const BSKY_POST_MAX_BYTES = 3000;
export const BSKY_POST_MAX_LANGS = 3;
export const BSKY_POST_MAX_TAGS = 8;
export const BSKY_TAG_MAX_GRAPHEMES = 64;
export const BSKY_EMBED_MAX_IMAGES = 4;
export const BSKY_IMAGE_MAX_BYTES = 2_000_000;
export const BSKY_EXTERNAL_THUMB_MAX_BYTES = 1_000_000;

export class BskyPostValidationError extends Error {}

// --- Text measurement -------------------------------------------------------

const segmenter =
  typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;

/** User-perceived character count — what a Bluesky client's counter shows. */
export function graphemeLength(text: string): number {
  if (segmenter) {
    let count = 0;
    for (const _ of segmenter.segment(text)) count += 1;
    return count;
  }
  return Array.from(text).length;
}

/** UTF-8 byte length — the unit `app.bsky.feed.post.text` maxLength and all facet offsets use. */
export function utf8ByteLength(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

// --- Facets ---------------------------------------------------------------

export interface FacetIndex {
  byteStart: number;
  byteEnd: number;
}
export interface MentionFeature {
  $type: "app.bsky.richtext.facet#mention";
  did: string;
}
export interface LinkFeature {
  $type: "app.bsky.richtext.facet#link";
  uri: string;
}
export interface TagFeature {
  $type: "app.bsky.richtext.facet#tag";
  tag: string;
}
export type FacetFeature = MentionFeature | LinkFeature | TagFeature;
export interface Facet {
  index: FacetIndex;
  features: FacetFeature[];
}

/** Resolve a handle (no leading `@`) to a DID, or null if it can't be resolved. */
export type ResolveHandleToDid = (handle: string) => Promise<string | null>;

export interface ParseFacetsOptions {
  resolveHandle?: ResolveHandleToDid;
}

// Approximations of @atproto/api's RichText.detectFacets regexes. Good for
// the common creator-composer cases; a post with an unusual URL may render
// as plain text in a Bluesky client (documented, docs/bluesky-public-posts.md §2).
const MENTION_RE = /(^|\s|\()(@)([a-zA-Z0-9][a-zA-Z0-9.-]*[a-zA-Z0-9](?:\.[a-zA-Z]{2,}))\b/g;
const URL_RE =
  /(^|\s|\()((?:https?:\/\/[^\s)]+)|(?:(?<![@.])[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+(?:\/[^\s)]*)?))/gi;
const TAG_RE = /(^|\s)[#＃]([^\s#＃.,;:!?'"()[\]{}]+)/g;

function byteOffsets(text: string, strStart: number, matched: string): FacetIndex {
  const byteStart = utf8ByteLength(text.slice(0, strStart));
  return { byteStart, byteEnd: byteStart + utf8ByteLength(matched) };
}

/** Trailing punctuation / an unbalanced `)` should not be part of a detected URL. */
function trimUrl(raw: string): string {
  let url = raw.replace(/[.,;:!?'"]+$/, "");
  if (url.endsWith(")") && !url.includes("(")) {
    url = url.slice(0, -1);
  }
  return url;
}

/**
 * Detects links, `@mentions` (resolved to DIDs — unresolvable handles are
 * dropped, not errored), and `#hashtags` in `text`, returning
 * `app.bsky.richtext.facet[]` with correct UTF-8 byte offsets. Pure given
 * the injected resolver.
 */
export async function parseFacets(text: string, options: ParseFacetsOptions = {}): Promise<Facet[]> {
  const facets: Facet[] = [];

  // Links
  for (const m of text.matchAll(URL_RE)) {
    const lead = m[1] ?? "";
    const rawMatch = m[2] ?? "";
    const strStart = (m.index ?? 0) + lead.length;
    const trimmed = trimUrl(rawMatch);
    if (!trimmed) continue;
    const uri = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    facets.push({
      index: byteOffsets(text, strStart, trimmed),
      features: [{ $type: "app.bsky.richtext.facet#link", uri }],
    });
  }

  // Mentions
  const resolve = options.resolveHandle;
  if (resolve) {
    for (const m of text.matchAll(MENTION_RE)) {
      const lead = m[1] ?? "";
      const at = m[2] ?? "@";
      const handle = m[3] ?? "";
      const strStart = (m.index ?? 0) + lead.length;
      let did: string | null = null;
      try {
        did = await resolve(handle);
      } catch {
        did = null;
      }
      if (!did) continue;
      facets.push({
        index: byteOffsets(text, strStart, `${at}${handle}`),
        features: [{ $type: "app.bsky.richtext.facet#mention", did }],
      });
    }
  }

  // Tags
  const seenTags = new Set<string>();
  let tagCount = 0;
  for (const m of text.matchAll(TAG_RE)) {
    if (tagCount >= BSKY_POST_MAX_TAGS) break;
    const lead = m[1] ?? "";
    const tag = (m[2] ?? "").replace(/‍/g, "");
    if (!tag || /^\d+$/.test(tag)) continue;
    if (graphemeLength(tag) > BSKY_TAG_MAX_GRAPHEMES) continue;
    const key = tag.toLowerCase();
    if (seenTags.has(key)) continue;
    seenTags.add(key);
    tagCount += 1;
    const strStart = (m.index ?? 0) + lead.length;
    facets.push({
      index: byteOffsets(text, strStart, `#${tag}`),
      features: [{ $type: "app.bsky.richtext.facet#tag", tag }],
    });
  }

  facets.sort((a, b) => a.index.byteStart - b.index.byteStart);
  return facets;
}

// --- Embeds --------------------------------------------------------------

export interface UploadedImage {
  /** The `blob` lexicon value returned by uploadBlob. */
  blob: Record<string, unknown>;
  mimeType: string;
  size: number;
  alt: string;
  aspectRatio?: { width: number; height: number };
}

export interface ExternalCard {
  uri: string;
  title: string;
  description: string;
  /** Already-uploaded thumbnail blob value, optional. */
  thumb?: Record<string, unknown>;
}

export function assertPublicImage(meta: { mimeType: string; size: number }): void {
  if (!meta.mimeType.startsWith("image/")) {
    throw new BskyPostValidationError(`Unsupported image type for a public post: ${meta.mimeType}`);
  }
  if (meta.size > BSKY_IMAGE_MAX_BYTES) {
    throw new BskyPostValidationError(
      `Image is ${meta.size} bytes; Bluesky public embeds allow at most ${BSKY_IMAGE_MAX_BYTES}.`,
    );
  }
}

export function assertExternalThumb(meta: { mimeType: string; size: number }): void {
  if (!meta.mimeType.startsWith("image/")) {
    throw new BskyPostValidationError(`Unsupported thumbnail type: ${meta.mimeType}`);
  }
  if (meta.size > BSKY_EXTERNAL_THUMB_MAX_BYTES) {
    throw new BskyPostValidationError(
      `Thumbnail is ${meta.size} bytes; Bluesky allows at most ${BSKY_EXTERNAL_THUMB_MAX_BYTES}.`,
    );
  }
}

/** Shapes an `app.bsky.embed.images` value from already-uploaded blobs. */
export function buildImagesEmbed(images: UploadedImage[]): Record<string, unknown> {
  if (images.length === 0 || images.length > BSKY_EMBED_MAX_IMAGES) {
    throw new BskyPostValidationError(`A Bluesky image embed carries 1–${BSKY_EMBED_MAX_IMAGES} images.`);
  }
  for (const img of images) {
    assertPublicImage(img);
    if (!img.alt && img.alt !== "") {
      throw new BskyPostValidationError("Every image in a Bluesky embed needs alt text.");
    }
  }
  return {
    $type: BSKY_NSID.embedImages,
    images: images.map((img) => ({
      image: img.blob,
      alt: img.alt,
      ...(img.aspectRatio ? { aspectRatio: img.aspectRatio } : {}),
    })),
  };
}

/** Shapes an `app.bsky.embed.external` value. */
export function buildExternalEmbed(card: ExternalCard): Record<string, unknown> {
  return {
    $type: BSKY_NSID.embedExternal,
    external: {
      uri: card.uri,
      title: card.title,
      description: card.description,
      ...(card.thumb ? { thumb: card.thumb } : {}),
    },
  };
}

// --- Record build / validate -------------------------------------------------

export interface BuildBskyPostInput {
  text: string;
  createdAt: Date | string;
  langs?: string[];
  tags?: string[];
  facets?: Facet[];
  /** Self-label values (content warnings), e.g. `["porn"]`. */
  labels?: string[];
  /** A pre-built embed value (see buildImagesEmbed / buildExternalEmbed). */
  embed?: Record<string, unknown>;
}

export type BskyPostRecord = {
  $type: "app.bsky.feed.post";
  text: string;
  createdAt: string;
  facets?: Facet[];
  langs?: string[];
  tags?: string[];
  labels?: { $type: "com.atproto.label.defs#selfLabels"; values: Array<{ val: string }> };
  embed?: Record<string, unknown>;
};

/**
 * Assembles a valid `app.bsky.feed.post`. Throws BskyPostValidationError if
 * the text/langs/tags exceed Bluesky's limits — the same limits the web
 * composer pre-checks (apps/web/lib/bskyPost.ts mirrors the constants).
 */
export function buildBskyPostRecord(input: BuildBskyPostInput): BskyPostRecord {
  const text = input.text ?? "";
  if (graphemeLength(text) > BSKY_POST_MAX_GRAPHEMES) {
    throw new BskyPostValidationError(
      `Post is ${graphemeLength(text)} characters; Bluesky posts allow at most ${BSKY_POST_MAX_GRAPHEMES}.`,
    );
  }
  if (utf8ByteLength(text) > BSKY_POST_MAX_BYTES) {
    throw new BskyPostValidationError(`Post exceeds Bluesky's ${BSKY_POST_MAX_BYTES}-byte limit.`);
  }
  if (input.langs && input.langs.length > BSKY_POST_MAX_LANGS) {
    throw new BskyPostValidationError(`At most ${BSKY_POST_MAX_LANGS} languages.`);
  }
  if (input.tags && input.tags.length > BSKY_POST_MAX_TAGS) {
    throw new BskyPostValidationError(`At most ${BSKY_POST_MAX_TAGS} tags.`);
  }
  for (const tag of input.tags ?? []) {
    if (graphemeLength(tag) > BSKY_TAG_MAX_GRAPHEMES) {
      throw new BskyPostValidationError(`Tag "${tag}" exceeds ${BSKY_TAG_MAX_GRAPHEMES} characters.`);
    }
  }

  const record: BskyPostRecord = {
    $type: "app.bsky.feed.post",
    text,
    createdAt: typeof input.createdAt === "string" ? input.createdAt : input.createdAt.toISOString(),
  };
  if (input.facets && input.facets.length > 0) record.facets = input.facets;
  if (input.langs && input.langs.length > 0) record.langs = input.langs;
  if (input.tags && input.tags.length > 0) record.tags = input.tags;
  if (input.labels && input.labels.length > 0) {
    record.labels = {
      $type: "com.atproto.label.defs#selfLabels",
      values: input.labels.map((val) => ({ val })),
    };
  }
  if (input.embed) record.embed = input.embed;
  return record;
}

/**
 * Structural check that a value is a lexicon-valid `app.bsky.feed.post`.
 * Throws BskyPostValidationError on the first problem. Mirrors the vendored
 * `packages/lexicons/vendor/app/bsky/feed/post.json` — kept in sync by
 * packages/atproto/src/bskyPost.test.ts.
 */
export function validateBskyPostRecord(record: unknown): asserts record is BskyPostRecord {
  if (typeof record !== "object" || record === null) {
    throw new BskyPostValidationError("Record must be an object.");
  }
  const r = record as Record<string, unknown>;
  if (r.$type !== "app.bsky.feed.post") {
    throw new BskyPostValidationError(`Wrong $type: ${String(r.$type)}`);
  }
  if (typeof r.text !== "string") {
    throw new BskyPostValidationError("`text` is required and must be a string.");
  }
  if (graphemeLength(r.text) > BSKY_POST_MAX_GRAPHEMES || utf8ByteLength(r.text) > BSKY_POST_MAX_BYTES) {
    throw new BskyPostValidationError("`text` exceeds Bluesky's length limits.");
  }
  if (typeof r.createdAt !== "string" || Number.isNaN(Date.parse(r.createdAt))) {
    throw new BskyPostValidationError("`createdAt` is required and must be an ISO-8601 datetime.");
  }
  if (r.langs !== undefined) {
    if (!Array.isArray(r.langs) || r.langs.length > BSKY_POST_MAX_LANGS) {
      throw new BskyPostValidationError(`\`langs\` must be an array of at most ${BSKY_POST_MAX_LANGS}.`);
    }
  }
  if (r.tags !== undefined) {
    if (!Array.isArray(r.tags) || r.tags.length > BSKY_POST_MAX_TAGS) {
      throw new BskyPostValidationError(`\`tags\` must be an array of at most ${BSKY_POST_MAX_TAGS}.`);
    }
  }
  if (r.facets !== undefined) {
    if (!Array.isArray(r.facets)) throw new BskyPostValidationError("`facets` must be an array.");
    for (const f of r.facets) {
      const facet = f as Facet;
      if (
        !facet.index ||
        typeof facet.index.byteStart !== "number" ||
        typeof facet.index.byteEnd !== "number" ||
        facet.index.byteStart < 0 ||
        facet.index.byteEnd < facet.index.byteStart
      ) {
        throw new BskyPostValidationError("Facet `index` byte range is invalid.");
      }
      if (!Array.isArray(facet.features) || facet.features.length === 0) {
        throw new BskyPostValidationError("Facet `features` must be a non-empty array.");
      }
    }
  }
  if (r.entities !== undefined) {
    throw new BskyPostValidationError("`entities` is deprecated and must not be written.");
  }
}

// --- AT URI helpers --------------------------------------------------------

export interface ParsedAtUri {
  did: string;
  collection: string;
  rkey: string;
}

/** `at://did:plc:abc/app.bsky.feed.post/3k...` → its parts, or null. */
export function parseAtUri(uri: string): ParsedAtUri | null {
  const m = /^at:\/\/([^/]+)\/([^/]+)\/([^/]+)$/.exec(uri);
  if (!m) return null;
  return { did: m[1]!, collection: m[2]!, rkey: m[3]! };
}

/** A public bsky.app permalink for an `app.bsky.feed.post` AT URI. */
export function bskyAppUrl(atUri: string, handleOrDid?: string | null): string | null {
  const parsed = parseAtUri(atUri);
  if (!parsed || parsed.collection !== BSKY_NSID.feedPost) return null;
  return `https://bsky.app/profile/${handleOrDid ?? parsed.did}/post/${parsed.rkey}`;
}
