"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button, EmptyState, Spinner } from "@/components/ui";
import { apiFetch } from "@/lib/apiFetch";
import { PostCard } from "@/components/post/PostCard";
import type { FeedPost } from "@/lib/post";

interface FeedResponse {
  posts: FeedPost[];
  nextCursor: string | null;
}

/**
 * The creator page's Posts tab. `GET /creators/:identifier/feed` is
 * cursor-paginated and never omits a post — an inaccessible gated post comes
 * back as a locked stub. Dual-published public posts arrive as one item with
 * `bskyAtUri` set and render as one card (prompts/bluesky-public-posts.md).
 */
export function CreatorFeed({ address, isOwner }: { address: string; isOwner: boolean }) {
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [loadingMore, setLoadingMore] = useState(false);
  const started = useRef(false);

  const fetchPage = useCallback(async (after: string | null) => {
    const qs = new URLSearchParams({ limit: "20" });
    if (after) qs.set("cursor", after);
    const res = await apiFetch(`/creators/${encodeURIComponent(address)}/feed?${qs.toString()}`);
    if (!res.ok) throw new Error(String(res.status));
    return (await res.json()) as FeedResponse;
  }, [address]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    fetchPage(null)
      .then((data) => {
        setPosts(data.posts);
        setCursor(data.nextCursor);
        setStatus("ready");
      })
      .catch(() => setStatus("error"));
  }, [fetchPage]);

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    try {
      const data = await fetchPage(cursor);
      setPosts((prev) => [...prev, ...data.posts]);
      setCursor(data.nextCursor);
    } catch {
      /* keep what we have */
    } finally {
      setLoadingMore(false);
    }
  }

  if (status === "loading") {
    return (
      <div className="flex justify-center py-8">
        <Spinner />
      </div>
    );
  }
  if (status === "error") {
    return <EmptyState title="Couldn't load posts" description="Try again in a moment." />;
  }
  if (posts.length === 0) {
    return (
      <EmptyState
        title="Nothing posted yet"
        description={isOwner ? "Your public posts will show up here — and on Bluesky." : "Check back later for posts."}
      />
    );
  }

  return (
    <div className="space-y-3">
      {posts.map((post) => (
        <PostCard
          key={post.id}
          post={post}
          href={`/c/${encodeURIComponent(address)}/post/${post.id}`}
          viewerIsOwner={isOwner}
        />
      ))}
      {cursor && (
        <div className="flex justify-center pt-2">
          <Button variant="secondary" size="sm" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? "Loading…" : "Load more"}
          </Button>
        </div>
      )}
    </div>
  );
}
