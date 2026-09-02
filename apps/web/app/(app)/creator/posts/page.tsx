import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui";
import { fetchApi } from "@/lib/serverApi";
import type { OwnPost } from "@/lib/post";
import { PostList } from "./PostList";

export const metadata: Metadata = { title: "Posts" };

interface OwnCreator {
  did: string;
  handle: string | null;
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

  // `GET /creators/:identifier/posts` with the owner's own session returns
  // every one of their posts (public and gated), newest first.
  const postsRes = await fetchApi(`/creators/${encodeURIComponent(address)}/posts`);
  if (!postsRes.ok) {
    throw new Error(`Failed to load posts: ${postsRes.status}`);
  }
  const posts = (await postsRes.json()) as OwnPost[];

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Posts</h1>
          <p className="mt-1 text-muted">
            Everything you&rsquo;ve posted. Public posts also sync to the AT Protocol network;
            subscriber posts never leave foryour.fans.
          </p>
        </div>
        <Button asChild size="sm" className="shrink-0">
          <Link href="/creator/posts/new">New post</Link>
        </Button>
      </div>

      <PostList initialPosts={posts} pageAddress={address} />
    </div>
  );
}
