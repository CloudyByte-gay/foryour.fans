import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { fetchApi } from "@/lib/serverApi";
import type { FeedPost } from "@/lib/post";
import { PostsManager } from "./PostsManager";

export const metadata: Metadata = { title: "Your posts" };

interface OwnCreator {
  did: string;
  handle: string | null;
}

interface OwnTier {
  id: string;
  name: string;
  isActive: boolean;
}

export default async function CreatorPostsPage() {
  const creatorRes = await fetchApi("/creators/me");
  if (creatorRes.status === 404) {
    redirect("/become-a-creator");
  }
  if (!creatorRes.ok) {
    throw new Error(`Failed to load /creators/me: ${creatorRes.status}`);
  }
  const creator = (await creatorRes.json()) as OwnCreator;
  const address = creator.handle ?? creator.did;

  const [tiersRes, feedRes] = await Promise.all([
    fetchApi("/creators/me/tiers"),
    // The owner's session unlocks their own gated posts, so no locked stubs here.
    fetchApi(`/creators/${encodeURIComponent(address)}/feed?limit=50`),
  ]);

  const tiers = tiersRes.ok ? ((await tiersRes.json()) as OwnTier[]).filter((t) => t.isActive) : [];
  const feed = feedRes.ok
    ? ((await feedRes.json()) as { posts: FeedPost[]; nextCursor: string | null })
    : { posts: [], nextCursor: null };

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Your posts</h1>
        <p className="mt-1 text-muted">
          Public posts publish to Bluesky-compatible feeds <strong>and</strong> your foryour.fans record.
          Subscriber-only posts stay private.
        </p>
      </div>
      <PostsManager
        pageAddress={address}
        tiers={tiers.map((t) => ({ id: t.id, name: t.name }))}
        initialPosts={feed.posts}
      />
    </div>
  );
}
