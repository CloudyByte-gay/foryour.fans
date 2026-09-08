import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { fetchApi } from "@/lib/serverApi";
import type { OwnPost, PostView, TierOption } from "@/lib/post";
import { PostComposer } from "../../PostComposer";

export const metadata: Metadata = { title: "Edit post" };

export default async function EditPostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();

  const [creatorRes, postRes, tiersRes] = await Promise.all([
    fetchApi("/creators/me"),
    fetchApi(`/posts/${encodeURIComponent(id)}`),
    fetchApi("/creators/me/tiers"),
  ]);

  if (creatorRes.status === 404) {
    redirect("/become-a-creator");
  }
  if (!creatorRes.ok) {
    throw new Error(`Failed to load /creators/me: ${creatorRes.status}`);
  }

  if (postRes.status === 404) {
    notFound();
  }
  if (!postRes.ok) {
    throw new Error(`Failed to load post: ${postRes.status}`);
  }
  const post = (await postRes.json()) as PostView;

  // The composer edits your own post only. A locked view (or a DID mismatch)
  // means it isn't yours — 404 rather than leak that it exists.
  if (post.locked || post.creator.did !== session.user?.did) {
    notFound();
  }

  const tiers = tiersRes.ok ? ((await tiersRes.json()) as TierOption[]) : [];
  const creator = (await creatorRes.json()) as { verificationStatus: "UNVERIFIED" | "PENDING" | "VERIFIED" };

  const seed: OwnPost = {
    id: post.id,
    creatorId: post.creatorId,
    visibility: post.visibility,
    minimumTierId: post.minimumTierId,
    text: post.text,
    media: post.media,
    containsAdultContent: post.containsAdultContent,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
  };

  return <PostComposer mode="edit" post={seed} tiers={tiers} isVerified={creator.verificationStatus === "VERIFIED"} />;
}
