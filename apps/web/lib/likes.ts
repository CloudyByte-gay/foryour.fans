import { apiFetch } from "@/lib/apiFetch";
import { csrfHeaders } from "@/lib/csrf";

/**
 * Client-safe like types + fetchers, mirrored from `POST`/`DELETE
 * /posts/:id/likes` (`apps/api/src/routes/likes.ts`). No `next/headers` /
 * server-only imports here — imported by client components.
 *
 * There is no `GET /posts/:id/likes` route — the initial `likeCount` /
 * `likedByViewer` / `likedByCreator` for a post ride along on `GET
 * /posts/:id` itself (see lib/post.ts's `UnlockedPostView` and
 * `getLikeSummary` in `apps/api/src/routes/posts.ts`); this module only
 * covers the toggle actions.
 */

/** The subset of `GET /posts/:id`'s response this module cares about. */
export interface LikeSummary {
  likeCount: number;
  likedByViewer: boolean;
  likedByCreator: boolean;
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
