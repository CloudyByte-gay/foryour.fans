import { z } from "zod";
import type { BadgeProps } from "@/components/ui";
import { apiFetch } from "@/lib/apiFetch";
import { csrfHeaders } from "@/lib/csrf";

/**
 * Client-safe post helpers, mirrored from the API's post routes
 * (`apps/api/src/routes/posts.ts`). The form schema rejects the same input
 * the server would (`createBodySchema` / `updateBodySchema` there), and the
 * types mirror `toPostResponse` / `toLockedStub`.
 *
 * No `next/headers` / server-only imports here — imported by client
 * components. Server components import the *types* only.
 *
 * Body text is **plain text** (the WEB PHASE 7 spec leaves "plain text or
 * minimal markdown" to be decided here): rendered with whitespace preserved,
 * never as HTML — no markdown parser, no rich-text surface, nothing to
 * sanitise. A richer editor can layer on later without changing storage.
 */

export const POST_TEXT_MAX = 10_000;

export type PostVisibility = "PUBLIC" | "SUBSCRIBERS" | "TIER";

/** One attachment on a post, as `GET /posts/:id` / feed responses expose it. */
export interface PostMedia {
  mediaAssetId: string;
  sortOrder: number;
  mimeType: string;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
}

interface VisibilityMeta {
  label: string;
  /** One-line description shown under the option in the composer. */
  hint: string;
  badge: NonNullable<BadgeProps["variant"]>;
}

export const POST_VISIBILITY_META: Record<PostVisibility, VisibilityMeta> = {
  PUBLIC: {
    label: "Public",
    hint: "Anyone can see it. Also published to Bluesky's open network (AT Protocol).",
    badge: "neutral",
  },
  SUBSCRIBERS: {
    label: "Subscribers",
    hint: "Any active subscriber, at any tier. Never leaves foryour.fans.",
    badge: "success",
  },
  TIER: {
    label: "Specific tier",
    hint: "Subscribers at the chosen tier or higher. Never leaves foryour.fans.",
    badge: "locked",
  },
};

export const VISIBILITY_ORDER: PostVisibility[] = ["PUBLIC", "SUBSCRIBERS", "TIER"];

/**
 * The persistent, unmissable warning shown while `Public` is selected — the
 * exact copy the WEB PHASE 7 spec mandates, enforcing `full.md`'s rule that
 * public and private posts have visibly different storage behaviour.
 */
export const PUBLIC_POST_WARNING =
  "This publishes to Bluesky's open network (AT Protocol) and can be replicated by other apps. " +
  "Subscriber-only content never leaves foryour.fans.";

/** Max attachments per post — mirror of `@foryour-fans/content`'s `MAX_POST_MEDIA`. */
export const POST_MEDIA_MAX = 20;

export const postFormSchema = z
  .object({
    visibility: z.enum(["PUBLIC", "SUBSCRIBERS", "TIER"]),
    minimumTierId: z.string().uuid().optional(),
    text: z
      .string()
      .trim()
      .min(1, "Write something first.")
      .max(POST_TEXT_MAX, `Keep it under ${POST_TEXT_MAX.toLocaleString()} characters.`),
    /** PUBLIC only — mirrored onto both the app.bsky.feed.post and fans.foryour.post. */
    langs: z.array(z.string().min(2).max(20)).max(3).optional(),
    tags: z.array(z.string().min(1).max(64)).max(8).optional(),
    /** Attachments (WEB PHASE 8) — READY media asset ids in display order. */
    media: z
      .array(z.object({ mediaAssetId: z.string().uuid(), sortOrder: z.number().int().min(0) }))
      .max(POST_MEDIA_MAX)
      .optional(),
    /** WEB PHASE 14 — requires the posting creator's `verificationStatus` to be VERIFIED; the composer disables this otherwise rather than letting the 403 surface. */
    containsAdultContent: z.boolean().optional(),
  })
  .refine((v) => v.visibility !== "TIER" || !!v.minimumTierId, {
    message: "Pick which tier unlocks this post.",
    path: ["minimumTierId"],
  });

export type PostFormValues = z.infer<typeof postFormSchema>;

/**
 * `toPostResponse` in the API — a creator's own post (list rows, edit seed).
 * The `*AtUri` / `canonicalUri` / `sourceCollections` fields are the
 * dual-published-post linkage (prompts/bluesky-public-posts.md): a PUBLIC
 * post published while `CREATOR_OWNED_PDS_ENABLED` is set is backed by both
 * an `app.bsky.feed.post` and a `fans.foryour.post`. All null /
 * `["fans.foryour.post"]` / `[]` otherwise.
 */
export interface OwnPost {
  id: string;
  creatorId: string;
  visibility: PostVisibility;
  minimumTierId: string | null;
  text: string;
  /**
   * Attachments (WEB PHASE 8), sorted by `sortOrder`. Asset metadata for
   * layout only — bytes are fetched on demand via `GET /media/:id/access`.
   */
  media: PostMedia[];
  createdAt: string;
  updatedAt: string;
  // Optional on the client (the API always sends them; older callers /
  // fixtures may omit them).
  foryourAtUri?: string | null;
  foryourAtCid?: string | null;
  bskyAtUri?: string | null;
  bskyAtCid?: string | null;
  canonicalUri?: string | null;
  sourceCollections?: string[];
  /**
   * WEB PHASE 14 — set only by a creator whose `verificationStatus` is
   * `VERIFIED` (`apps/api/src/routes/posts.ts` 403s otherwise). Drives the
   * NSFW media blur (`lib/mediaItems.ts#toGalleryItems`) and the age gate.
   * Optional on the client like its siblings above — the API always sends
   * it; older fixtures may omit it, in which case it's treated as `false`.
   */
  containsAdultContent?: boolean;
}

export interface PostCreatorIdentity {
  did: string;
  handle: string | null;
  displayName: string | null;
}

export interface RequiredTierSummary {
  id: string;
  name: string;
  priceCents: number;
  currency: string;
}

/** The fields the composer's `TIER` picker needs from `GET /creators/me/tiers`. */
export interface TierOption {
  id: string;
  name: string;
  priceCents: number;
  currency: string;
  isActive: boolean;
}

/** `GET /posts/:id` for an entitled viewer / the creator / a PUBLIC post. */
export interface UnlockedPostView extends OwnPost {
  locked: false;
  creator: PostCreatorIdentity;
  /**
   * Like summary (WEB PHASE 12) — always present on this branch, never on
   * `LockedPostView` (no like button on a locked post). See
   * `getLikeSummary` in `apps/api/src/routes/posts.ts`.
   */
  likeCount: number;
  likedByViewer: boolean;
  likedByCreator: boolean;
  /**
   * WEB PHASE 14 — moderator/classifier-applied `ContentLabel` values, net
   * of any retraction (`listEffectiveLabels`). Only computed on this
   * single-post view, not on feed/list rows (avoids an N+1 query per row —
   * see docs/ux.md's Phase 14 known limitations). Distinct from a creator's
   * own AT-record self-labels, an older, separate mechanism.
   */
  labels: string[];
}

/** `GET /posts/:id` for a non-entitled viewer — safe metadata only, no `text`. */
export interface LockedPostView {
  id: string;
  creatorId: string;
  visibility: PostVisibility;
  createdAt: string;
  locked: true;
  hasMedia: boolean;
  requiredTier: RequiredTierSummary | null;
  creator: PostCreatorIdentity;
}

export type PostView = UnlockedPostView | LockedPostView;

interface ApiError {
  error?: { message?: string; statusCode?: number };
}

async function readApiError(res: Response, fallback: string): Promise<string> {
  if (res.status === 502) {
    return "Saved, but publishing to Bluesky failed. Try again.";
  }
  const body = (await res.json().catch(() => null)) as ApiError | null;
  return body?.error?.message ?? fallback;
}

export type SavePostOutcome =
  | { ok: true; post: OwnPost }
  | { ok: false; message: string };

function toPayload(values: PostFormValues) {
  const isPublic = values.visibility === "PUBLIC";
  return {
    visibility: values.visibility,
    text: values.text.trim(),
    ...(values.visibility === "TIER" ? { minimumTierId: values.minimumTierId } : {}),
    ...(isPublic && values.langs && values.langs.length > 0 ? { langs: values.langs } : {}),
    ...(isPublic && values.tags && values.tags.length > 0 ? { tags: values.tags } : {}),
    // Always sent so `PATCH` full-replace works (omitting it would keep the
    // post's current attachments; the composer always states the full set).
    media: (values.media ?? []).map((m, index) => ({ mediaAssetId: m.mediaAssetId, sortOrder: index })),
    // Omitted (not `false`) when the composer hides the checkbox for an
    // unverified creator — the API leaves the field unchanged on `PATCH`
    // rather than clearing a pre-existing `true` (see
    // `UpdatePostInput.containsAdultContent` in `@foryour-fans/content`).
    ...(values.containsAdultContent !== undefined
      ? { containsAdultContent: values.containsAdultContent }
      : {}),
  };
}

/** `POST /creators/me/posts`. */
export async function createPost(values: PostFormValues): Promise<SavePostOutcome> {
  let res: Response;
  try {
    res = await apiFetch("/creators/me/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...csrfHeaders() },
      body: JSON.stringify(toPayload(values)),
    });
  } catch {
    return { ok: false, message: "We couldn't reach foryour.fans. Check your connection and try again." };
  }
  if (res.status === 201) {
    return { ok: true, post: (await res.json()) as OwnPost };
  }
  return { ok: false, message: await readApiError(res, "Couldn't save the post.") };
}

/** `PATCH /creators/me/posts/:id`. */
export async function updatePost(id: string, values: PostFormValues): Promise<SavePostOutcome> {
  let res: Response;
  try {
    res = await apiFetch(`/creators/me/posts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...csrfHeaders() },
      body: JSON.stringify(toPayload(values)),
    });
  } catch {
    return { ok: false, message: "We couldn't reach foryour.fans. Check your connection and try again." };
  }
  if (res.ok) {
    return { ok: true, post: (await res.json()) as OwnPost };
  }
  return { ok: false, message: await readApiError(res, "Couldn't save the post.") };
}

/** `DELETE /creators/me/posts/:id`. */
export async function deletePost(id: string): Promise<{ ok: true } | { ok: false; message: string }> {
  let res: Response;
  try {
    res = await apiFetch(`/creators/me/posts/${id}`, {
      method: "DELETE",
      headers: { ...csrfHeaders() },
    });
  } catch {
    return { ok: false, message: "We couldn't reach foryour.fans. Check your connection and try again." };
  }
  if (res.status === 204) {
    return { ok: true };
  }
  return { ok: false, message: await readApiError(res, "Couldn't delete the post.") };
}

// --- Feed / card helpers (prompts/bluesky-public-posts.md) -------------------

/**
 * A feed/card row: a full post (`GET /feed`, `GET /creators/:id/feed`
 * unlocked, or a composer response) or a locked stub. One authored post is
 * rendered once — a dual-published post is a single item with `bskyAtUri`
 * set, never two.
 */
export interface FullPost extends OwnPost {
  creator?: PostCreatorIdentity | null;
  locked?: false;
}

export interface LockedPost {
  id: string;
  creatorId: string;
  visibility: PostVisibility;
  createdAt: string;
  locked: true;
  hasMedia: boolean;
  requiredTier: RequiredTierSummary | null;
  creator?: PostCreatorIdentity | null;
}

export type FeedPost = FullPost | LockedPost;

export function isLocked(post: FeedPost): post is LockedPost {
  return post.locked === true;
}

export interface PostBadge {
  label: string;
  variant: NonNullable<BadgeProps["variant"]>;
}

/**
 * The small source/status chips a card shows — one authored post, never a
 * separate chip set per AT record. A dual-published public post reads
 * "Public" + "Bluesky"; a gated one the viewer can read because they're
 * entitled reads "Subscriber-only" / "Tier" + "Subscribed"; the creator's own
 * view of the same post skips "Subscribed" (`viewerIsOwner`) since they
 * didn't unlock it by subscribing; an inaccessible one "Locked".
 */
export function postBadges(post: FeedPost, opts: { viewerIsOwner?: boolean } = {}): PostBadge[] {
  if (isLocked(post)) {
    return [
      {
        label: post.requiredTier ? `Tier · ${post.requiredTier.name}` : "Subscriber-only",
        variant: "neutral",
      },
      { label: "Locked", variant: "locked" },
    ];
  }
  if (post.visibility === "PUBLIC") {
    const badges: PostBadge[] = [{ label: "Public", variant: "success" }];
    if (post.bskyAtUri) badges.push({ label: "Bluesky", variant: "primary" });
    if (post.containsAdultContent) badges.push({ label: "18+", variant: "danger" });
    return badges;
  }
  const badges: PostBadge[] = [
    { label: post.visibility === "TIER" ? "Tier" : "Subscriber-only", variant: "neutral" },
  ];
  if (!opts.viewerIsOwner) badges.push({ label: "Subscribed", variant: "success" });
  if (post.containsAdultContent) badges.push({ label: "18+", variant: "danger" });
  return badges;
}

/**
 * Given the ids of every post in a creator's feed (newest first, the order
 * `GET /creators/:identifier/feed` returns) and the id of the post currently
 * being viewed, find its prev/next neighbors (WEB PHASE 9's "next/prev
 * navigation within the creator feed"). `newerId` is one slot closer to
 * index 0 (posted after `postId`); `olderId` the reverse. Both null when
 * `postId` isn't in `ids` at all (e.g. older than the fetched window).
 */
export function findFeedNeighbors(
  ids: string[],
  postId: string,
): { newerId: string | null; olderId: string | null } {
  const index = ids.indexOf(postId);
  if (index === -1) return { newerId: null, olderId: null };
  return {
    newerId: index > 0 ? ids[index - 1]! : null,
    olderId: index < ids.length - 1 ? ids[index + 1]! : null,
  };
}

/** at://did/app.bsky.feed.post/rkey → https://bsky.app/profile/<handleOrDid>/post/<rkey> */
export function bskyAppUrl(atUri: string | null | undefined, handleOrDid?: string | null): string | null {
  if (!atUri) return null;
  const m = /^at:\/\/([^/]+)\/app\.bsky\.feed\.post\/([^/]+)$/.exec(atUri);
  if (!m) return null;
  return `https://bsky.app/profile/${handleOrDid ?? m[1]}/post/${m[2]}`;
}
