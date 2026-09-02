/**
 * Post response shapes from `apps/api` and the helpers the feed / composer /
 * single-post UI use to render one authored post once — whether it is backed
 * by a `fans.foryour.post`, an `app.bsky.feed.post`, or both
 * (prompts/bluesky-public-posts.md, docs/bluesky-public-posts.md).
 */

export type PostVisibility = "PUBLIC" | "SUBSCRIBERS" | "TIER";

export interface PostCreator {
  did: string;
  handle: string | null;
}

/** `toPostResponse` in apps/api/src/routes/posts.ts. */
export interface FullPost {
  id: string;
  creatorId: string;
  visibility: PostVisibility;
  minimumTierId: string | null;
  text: string;
  media: Array<{ mediaAssetId: string; sortOrder: number }>;
  createdAt: string;
  updatedAt: string;
  foryourAtUri: string | null;
  foryourAtCid: string | null;
  bskyAtUri: string | null;
  bskyAtCid: string | null;
  canonicalUri: string | null;
  sourceCollections: string[];
  creator?: PostCreator | null;
  locked?: false;
}

/** `toLockedStub` in apps/api/src/routes/feed.ts. */
export interface LockedPost {
  id: string;
  creatorId: string;
  visibility: PostVisibility;
  createdAt: string;
  locked: true;
  hasMedia: boolean;
  requiredTier: { id: string; name: string; priceCents: number; currency: string } | null;
  creator?: PostCreator | null;
}

export type FeedPost = FullPost | LockedPost;

export function isLocked(post: FeedPost): post is LockedPost {
  return post.locked === true;
}

export interface PostBadge {
  label: string;
  /** Maps to <Badge variant>. */
  variant: "neutral" | "success" | "primary" | "locked";
}

/**
 * The small source/status chips a card shows — one authored post, never a
 * separate chip set per AT record. A dual-published public post reads
 * "Public" + "Bluesky"; a gated one reads "Subscriber-only" / "Tier"; an
 * inaccessible gated one reads "Locked".
 */
export function postBadges(post: FeedPost): PostBadge[] {
  if (isLocked(post)) {
    const tier = post.requiredTier;
    return [
      { label: tier ? `Tier · ${tier.name}` : "Subscriber-only", variant: "neutral" },
      { label: "Locked", variant: "locked" },
    ];
  }
  if (post.visibility === "PUBLIC") {
    const badges: PostBadge[] = [{ label: "Public", variant: "success" }];
    if (post.bskyAtUri) badges.push({ label: "Bluesky", variant: "primary" });
    return badges;
  }
  if (post.visibility === "TIER") {
    return [{ label: "Tier", variant: "neutral" }];
  }
  return [{ label: "Subscriber-only", variant: "neutral" }];
}

/** at://did/app.bsky.feed.post/rkey → https://bsky.app/profile/<handleOrDid>/post/<rkey> */
export function bskyAppUrl(atUri: string | null, handleOrDid?: string | null): string | null {
  if (!atUri) return null;
  const m = /^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/([^/]+)$/.exec(atUri);
  if (!m) return null;
  return `https://bsky.app/profile/${handleOrDid ?? m[1]}/post/${m[2]}`;
}
