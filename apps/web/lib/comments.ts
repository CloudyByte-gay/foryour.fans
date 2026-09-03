import { apiFetch } from "@/lib/apiFetch";
import { csrfHeaders } from "@/lib/csrf";

/**
 * Client-safe comment types + fetchers, mirrored from `GET`/`POST
 * /posts/:id/comments` (`apps/api/src/routes/comments.ts`). No
 * `next/headers` / server-only imports here — imported by client
 * components; server components import the *types* only.
 *
 * Comments are Postgres-only and never touch the AT network, for any post
 * visibility — see that route's own doc comment. Body text is plain text,
 * same rule as post bodies (lib/post.ts).
 */

export const COMMENT_TEXT_MAX = 2000;

export interface CommentAuthor {
  did: string;
  handle: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface Comment {
  id: string;
  postId: string;
  text: string;
  createdAt: string;
  author: CommentAuthor;
}

export interface CommentsPage {
  comments: Comment[];
  nextCursor: string | null;
}

export const EMPTY_COMMENTS_PAGE: CommentsPage = { comments: [], nextCursor: null };

interface ApiError {
  error?: { message?: string };
}

async function readCommentApiError(res: Response, fallback: string): Promise<string> {
  if (res.status === 429) {
    return "You're doing that too fast — try again in a moment.";
  }
  const body = (await res.json().catch(() => null)) as ApiError | null;
  return body?.error?.message ?? fallback;
}

/** `GET /posts/:id/comments` — used both for the server-rendered first page and client-side "load more". */
export async function fetchComments(postId: string, cursor: string | null = null): Promise<CommentsPage> {
  const qs = new URLSearchParams({ limit: "20" });
  if (cursor) qs.set("cursor", cursor);
  const res = await apiFetch(`/posts/${encodeURIComponent(postId)}/comments?${qs.toString()}`);
  if (!res.ok) throw new Error(String(res.status));
  return (await res.json()) as CommentsPage;
}

export type PostCommentOutcome = { ok: true; comment: Comment } | { ok: false; message: string };

/** `POST /posts/:id/comments`. */
export async function postComment(postId: string, text: string): Promise<PostCommentOutcome> {
  let res: Response;
  try {
    res = await apiFetch(`/posts/${encodeURIComponent(postId)}/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...csrfHeaders() },
      body: JSON.stringify({ text }),
    });
  } catch {
    return { ok: false, message: "We couldn't reach foryour.fans. Check your connection and try again." };
  }
  if (res.status === 201) {
    return { ok: true, comment: (await res.json()) as Comment };
  }
  return { ok: false, message: await readCommentApiError(res, "Couldn't post your comment.") };
}
