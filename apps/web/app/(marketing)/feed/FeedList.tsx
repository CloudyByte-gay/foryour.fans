"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { Button, EmptyState } from "@/components/ui";
import { apiFetch } from "@/lib/apiFetch";
import { PostCard } from "@/components/post/PostCard";
import { useSession } from "@/components/providers/SessionProvider";
import type { FullPost } from "@/lib/post";

/**
 * The home feed. `GET /feed` is limit-only (no cursor — see
 * docs/architecture.md's Phase 9 section), so "load more" just asks for a
 * larger page. A dual-published public post arrives already deduped by the
 * API (one item, `bskyAtUri` set) and renders as one card.
 */
export function FeedList({ initialPosts }: { initialPosts: FullPost[] }) {
  const session = useSession();
  const [posts, setPosts] = useState<FullPost[]>(initialPosts);
  const [limit, setLimit] = useState(20);
  const [loading, setLoading] = useState(false);
  const [exhausted, setExhausted] = useState(initialPosts.length < 20);

  const loadMore = useCallback(async () => {
    const next = limit + 20;
    setLoading(true);
    try {
      const res = await apiFetch(`/feed?limit=${next}`);
      if (res.ok) {
        const rows = (await res.json()) as FullPost[];
        setPosts(rows);
        setLimit(next);
        setExhausted(rows.length < next);
      }
    } finally {
      setLoading(false);
    }
  }, [limit]);

  if (posts.length === 0) {
    return (
      <EmptyState
        title="Nothing here yet"
        description="Follow the network — public posts from creators show up here, on Bluesky, and everywhere else."
        action={
          <Button asChild variant="secondary" size="sm">
            <Link href="/discover">Discover creators</Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-3">
      {posts.map((post) => (
        <PostCard
          key={post.id}
          post={post}
          href={
            post.creator?.handle || post.creator?.did
              ? `/c/${encodeURIComponent(post.creator.handle ?? post.creator.did)}/post/${post.id}`
              : undefined
          }
          like={{ isAuthed: session.status === "authenticated" }}
        />
      ))}
      {!exhausted && (
        <div className="flex justify-center pt-2">
          <Button variant="secondary" size="sm" onClick={loadMore} disabled={loading}>
            {loading ? "Loading…" : "Load more"}
          </Button>
        </div>
      )}
    </div>
  );
}
