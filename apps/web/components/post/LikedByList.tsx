"use client";

import { Heart } from "lucide-react";
import Link from "next/link";
import { useCallback, useState } from "react";
import { Avatar, InfiniteList } from "@/components/ui";
import { fetchPostLikes, type PostLike, type PostLikesPage } from "@/lib/likes";

function actorName(actor: PostLike["actor"]): string {
  return actor.displayName ?? `@${actor.handle ?? actor.did}`;
}

function actorHref(actor: PostLike["actor"]): string {
  return `/c/${actor.handle ?? actor.did}`;
}

/**
 * The bsky-style "liked by" list on `/c/:handle/post/:id`, backed by
 * `GET /posts/:id/likes` (`fetchPostLikes`). Collapsed to a "Liked by N"
 * summary by default; expanding reveals the paginated list. Renders nothing
 * when the post has no likes yet. For a gated post the API returns 403 to
 * non-entitled viewers, so this only ever appears where the viewer can
 * already read the post.
 */
export function LikedByList({ postId, initialPage }: { postId: string; initialPage: PostLikesPage }) {
  const [likes, setLikes] = useState<PostLike[]>(initialPage.likes);
  const [cursor, setCursor] = useState<string | null>(initialPage.nextCursor);
  const [expanded, setExpanded] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState(false);

  const loadMore = useCallback(async () => {
    if (!cursor) return;
    setLoadingMore(true);
    setMoreError(false);
    try {
      const page = await fetchPostLikes(postId, cursor);
      setLikes((prev) => [...prev, ...page.likes]);
      setCursor(page.nextCursor);
    } catch {
      setMoreError(true);
    } finally {
      setLoadingMore(false);
    }
  }, [postId, cursor]);

  if (likes.length === 0) return null;

  const total = cursor !== null ? `${likes.length}+` : String(likes.length);

  return (
    <section className="mt-4" aria-labelledby="liked-by-heading">
      <button
        type="button"
        id="liked-by-heading"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground"
      >
        <Heart className="h-3.5 w-3.5" aria-hidden />
        Liked by {total}
      </button>

      {expanded && (
        <div className="mt-3">
          <InfiniteList hasMore={cursor !== null} isLoading={loadingMore} onLoadMore={loadMore} error={moreError}>
            <ul className="space-y-2">
              {likes.map((like) => (
                <li key={like.actor.did}>
                  <Link
                    href={actorHref(like.actor)}
                    className="flex items-center gap-2 rounded-md px-1 py-1 hover:bg-surface-muted"
                  >
                    <Avatar src={like.actor.avatarUrl ?? undefined} name={actorName(like.actor)} size="sm" />
                    <span className="text-sm">{actorName(like.actor)}</span>
                    {like.actor.handle && (
                      <span className="text-xs text-muted">@{like.actor.handle}</span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </InfiniteList>
        </div>
      )}
    </section>
  );
}
