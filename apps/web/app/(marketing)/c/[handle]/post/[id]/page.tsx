import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { LockedPostCard } from "@/components/creator/LockedPostCard";
import { PostArticle } from "@/components/creator/PostArticle";
import { fetchApi } from "@/lib/serverApi";
import { getSession } from "@/lib/session";
import type { PostView } from "@/lib/post";

function decodeIdentifierParam(identifier: string): string {
  try {
    return decodeURIComponent(identifier);
  } catch {
    return identifier;
  }
}

// `cache()` so generateMetadata and the page share a single fetch.
const loadPost = cache(async (id: string): Promise<PostView | null> => {
  try {
    const res = await fetchApi(`/posts/${encodeURIComponent(id)}`);
    if (!res.ok) return null;
    return (await res.json()) as PostView;
  } catch {
    return null;
  }
});

function creatorAddress(view: PostView): string {
  return view.creator.handle ?? view.creator.did;
}

function creatorName(view: PostView): string {
  return view.creator.displayName ?? `@${creatorAddress(view)}`;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string; id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const view = await loadPost(id);
  if (!view) {
    return { title: "Post not found", robots: { index: false } };
  }
  const name = creatorName(view);

  // Only a fully-public post is safe to index or describe with its own text.
  if (view.locked || view.visibility !== "PUBLIC") {
    return { title: `Post by ${name}`, robots: { index: false } };
  }

  const description = view.text.trim().replace(/\s+/g, " ").slice(0, 160);
  const address = creatorAddress(view);
  return {
    title: `${name} on foryour.fans`,
    description,
    alternates: { canonical: `/c/${address}/post/${view.id}` },
    openGraph: { title: name, description, url: `/c/${address}/post/${view.id}`, type: "article" },
  };
}

export default async function PostPage({
  params,
}: {
  params: Promise<{ handle: string; id: string }>;
}) {
  const { handle, id } = await params;
  const [view, session] = await Promise.all([loadPost(id), getSession()]);

  if (!view) {
    notFound();
  }

  const address = creatorAddress(view);
  const segment = decodeIdentifierParam(handle);
  // Normalise a stale-handle or mistyped permalink to the canonical address.
  // `/c/<did>/post/<id>` is legitimate and left alone.
  if (segment !== view.creator.handle && segment !== view.creator.did) {
    redirect(`/c/${address}/post/${view.id}`);
  }

  const name = creatorName(view);
  const isAuthed = session.status === "authenticated";

  if (view.locked) {
    return (
      <LockedPostCard creatorAddress={address} creatorName={name} isAuthed={isAuthed} view={view} />
    );
  }
  return <PostArticle creatorAddress={address} creatorName={name} view={view} />;
}
