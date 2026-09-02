"use client";

import { useState } from "react";
import { EmptyState } from "@/components/ui";
import { PostCard } from "@/components/post/PostCard";
import type { FeedPost, FullPost } from "@/lib/post";
import { PostComposer } from "./PostComposer";

export function PostsManager({
  pageAddress,
  tiers,
  initialPosts,
}: {
  pageAddress: string;
  tiers: Array<{ id: string; name: string }>;
  initialPosts: FeedPost[];
}) {
  const [posts, setPosts] = useState<FeedPost[]>(initialPosts);

  function handleCreated(post: FullPost) {
    setPosts((prev) => [post, ...prev]);
  }

  return (
    <div className="space-y-6">
      <PostComposer tiers={tiers} onCreated={handleCreated} />

      <div className="space-y-3">
        {posts.length === 0 ? (
          <EmptyState title="No posts yet" description="Your public posts will also show up on Bluesky." />
        ) : (
          posts.map((post) => (
            <PostCard
              key={post.id}
              post={post}
              href={`/c/${encodeURIComponent(pageAddress)}/post/${post.id}`}
            />
          ))
        )}
      </div>
    </div>
  );
}
