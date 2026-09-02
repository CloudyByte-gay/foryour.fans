/**
 * Bluesky `app.bsky.feed.post` limits, mirrored from
 * `packages/atproto/src/bskyPost.ts` (the server enforces them; this is for
 * the composer's live validation only — keep the two in sync). See
 * `docs/bluesky-public-posts.md`.
 */
export const BSKY_POST_MAX_GRAPHEMES = 300;
export const BSKY_POST_MAX_BYTES = 3000;
export const BSKY_POST_MAX_LANGS = 3;
export const BSKY_POST_MAX_TAGS = 8;
export const BSKY_TAG_MAX_GRAPHEMES = 64;

const segmenter =
  typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;

/** User-perceived character count — what the composer's counter shows. */
export function graphemeLength(text: string): number {
  if (segmenter) {
    let n = 0;
    for (const _ of segmenter.segment(text)) n += 1;
    return n;
  }
  return Array.from(text).length;
}

export function utf8ByteLength(text: string): number {
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(text).length;
  }
  return text.length;
}

export interface BskyFitProblem {
  message: string;
}

/**
 * Returns the reasons a PUBLIC post's text/langs/tags can't be published as a
 * normal Bluesky post — empty array means it fits.
 */
export function bskyFitProblems(input: { text: string; langs?: string[]; tags?: string[] }): BskyFitProblem[] {
  const problems: BskyFitProblem[] = [];
  const graphemes = graphemeLength(input.text);
  if (graphemes > BSKY_POST_MAX_GRAPHEMES) {
    problems.push({ message: `${graphemes} / ${BSKY_POST_MAX_GRAPHEMES} characters — too long for a Bluesky post.` });
  }
  if (utf8ByteLength(input.text) > BSKY_POST_MAX_BYTES) {
    problems.push({ message: `Exceeds Bluesky's ${BSKY_POST_MAX_BYTES}-byte limit.` });
  }
  if ((input.langs?.length ?? 0) > BSKY_POST_MAX_LANGS) {
    problems.push({ message: `At most ${BSKY_POST_MAX_LANGS} languages.` });
  }
  if ((input.tags?.length ?? 0) > BSKY_POST_MAX_TAGS) {
    problems.push({ message: `At most ${BSKY_POST_MAX_TAGS} tags.` });
  }
  for (const tag of input.tags ?? []) {
    if (graphemeLength(tag) > BSKY_TAG_MAX_GRAPHEMES) {
      problems.push({ message: `Tag "${tag}" is longer than ${BSKY_TAG_MAX_GRAPHEMES} characters.` });
    }
  }
  return problems;
}
