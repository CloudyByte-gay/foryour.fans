import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { fetchApi } from "@/lib/serverApi";
import type { TierOption } from "@/lib/post";
import { PostComposer } from "../PostComposer";

export const metadata: Metadata = { title: "New post" };

export default async function NewPostPage() {
  const [creatorRes, tiersRes] = await Promise.all([
    fetchApi("/creators/me"),
    fetchApi("/creators/me/tiers"),
  ]);

  if (creatorRes.status === 404) {
    redirect("/become-a-creator");
  }
  if (!creatorRes.ok) {
    throw new Error(`Failed to load /creators/me: ${creatorRes.status}`);
  }

  const tiers = tiersRes.ok ? ((await tiersRes.json()) as TierOption[]) : [];
  const creator = (await creatorRes.json()) as { verificationStatus: "UNVERIFIED" | "PENDING" | "VERIFIED" };

  return <PostComposer mode="create" tiers={tiers} isVerified={creator.verificationStatus === "VERIFIED"} />;
}
