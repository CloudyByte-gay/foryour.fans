import { apiFetch } from "@/lib/apiFetch";
import { csrfHeaders } from "@/lib/csrf";

/**
 * Client-safe like types + fetchers, mirrored from `POST`/`DELETE`/`GET
 * /posts/:id/likes` (`apps/api/src/routes/likes.ts`). No `next/headers` /
 * server-only imports here — imported by client components.
 *
 * The initial `likeCount` / `likedByViewer` / `likedByCreator` for a post
 * ride along on `GET /posts/:id` itself (see lib/post.ts's
 * `UnlockedPostView`); feed/card counts ride along on the feed responses.
 * `GET /posts/:id/likes` is the bsky-style "liked by" list — see
 * `fetchPostLikes` below.
 */

/** The subset of `GET /posts/:id`'s response this module cares about. */
export interface LikeSummary {
  likeCount: number;
  likedByViewer: boolean;
  likedByCreator: boolean;
}

/** One entry from `GET /posts/:id/likes` — `app.bsky.feed.getLikes`-shaped. */
export interface PostLikeActor {
  did: string;
  handle: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface PostLike {
  actor: PostLikeActor;
  createdAt: string;
}

export interface PostLikesPage {
  likes: PostLike[];
  nextCursor: string | null;
}

export const EMPTY_POST_LIKES_PAGE: PostLikesPage = { likes: [], nextCursor: null };

/**
 * `GET /posts/:id/likes` — one page of the "liked by" list, newest first.
 * Anonymous-readable for a PUBLIC post; a gated post returns 403 to
 * non-entitled viewers (this throws on any non-OK response so callers can
 * fall back to `EMPTY_POST_LIKES_PAGE`).
 */
export async function fetchPostLikes(postId: string, cursor: string | null = null): Promise<PostLikesPage> {
  const qs = new URLSearchParams({ limit: "30" });
  if (cursor) qs.set("cursor", cursor);
  const res = await apiFetch(`/posts/${encodeURIComponent(postId)}/likes?${qs.toString()}`);
  if (!res.ok) {
    throw new Error(`GET /posts/${postId}/likes -> ${res.status}`);
  }
  return (await res.json()) as PostLikesPage;
}

interface ApiError {
  error?: { message?: string };
}

async function readLikeApiError(res: Response, fallback: string): Promise<string> {
  if (res.status === 429) {
    return "You're doing that too fast — try again in a moment.";
  }
  const body = (await res.json().catch(() => null)) as ApiError | null;
  return body?.error?.message ?? fallback;
}

export type ToggleLikeOutcome =
  | { ok: true; likeCount: number; likedByViewer: boolean }
  | { ok: false; message: string };

async function toggleLike(postId: string, method: "POST" | "DELETE"): Promise<ToggleLikeOutcome> {
  let res: Response;
  try {
    res = await apiFetch(`/posts/${encodeURIComponent(postId)}/likes`, {
      method,
      headers: { ...csrfHeaders() },
    });
  } catch {
    return { ok: false, message: "We couldn't reach foryour.fans. Check your connection and try again." };
  }
  if (res.ok) {
    return { ok: true, ...((await res.json()) as { likeCount: number; likedByViewer: boolean }) };
  }
  return {
    ok: false,
    message: await readLikeApiError(res, method === "POST" ? "Couldn't like this post." : "Couldn't remove your like."),
  };
}

/** `POST /posts/:id/likes` — idempotent server-side; safe to call even if already liked. */
export function likePost(postId: string): Promise<ToggleLikeOutcome> {
  return toggleLike(postId, "POST");
}

/** `DELETE /posts/:id/likes` — idempotent server-side; safe to call even if never liked. */
export function unlikePost(postId: string): Promise<ToggleLikeOutcome> {
  return toggleLike(postId, "DELETE");
}
