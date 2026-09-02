import type { Metadata } from "next";
import { fetchApi } from "@/lib/serverApi";
import type { FullPost } from "@/lib/post";
import { FeedList } from "./FeedList";

export const metadata: Metadata = { title: "Feed" };

export default async function FeedPage() {
  const res = await fetchApi("/feed?limit=20");
  const initial = res.ok ? ((await res.json()) as FullPost[]) : [];

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Feed</h1>
        <p className="mt-1 text-muted">
          Public posts (also on Bluesky) plus posts from creators you subscribe to.
        </p>
      </div>
      <FeedList initialPosts={initial} />
    </div>
  );
}
