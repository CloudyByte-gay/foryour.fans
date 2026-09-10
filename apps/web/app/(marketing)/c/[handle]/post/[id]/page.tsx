import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { LockedPostCard } from "@/components/creator/LockedPostCard";
import { PostArticle } from "@/components/creator/PostArticle";
import { fetchApi } from "@/lib/serverApi";
import { getSession } from "@/lib/session";
import { findFeedNeighbors, type PostView } from "@/lib/post";
import { EMPTY_COMMENTS_PAGE, type CommentsPage } from "@/lib/comments";
import { EMPTY_POST_LIKES_PAGE, type PostLikesPage } from "@/lib/likes";

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

/**
 * Prev/next navigation within the creator's feed (WEB PHASE 9). There's no
 * "get a post's neighbors" route — this reuses `GET /creators/:id/feed` and
 * locates the post, server-side, within one page of it. A post older than
 * this window (very active creators) just gets no nav, an accepted
 * degradation rather than an unbounded cursor walk.
 */
const NEIGHBOR_WINDOW = 50;

async function loadNeighbors(
  address: string,
  postId: string,
): Promise<{ newerId: string | null; olderId: string | null }> {
  try {
    const res = await fetchApi(`/creators/${encodeURIComponent(address)}/feed?limit=${NEIGHBOR_WINDOW}`);
    if (!res.ok) return { newerId: null, olderId: null };
    const data = (await res.json()) as { posts: { id: string }[] };
    return findFeedNeighbors(data.posts.map((p) => p.id), postId);
  } catch {
    return { newerId: null, olderId: null };
  }
}

function creatorName(view: PostView): string {
  return view.creator.displayName ?? `@${creatorAddress(view)}`;
}

/** First page of comments (WEB PHASE 12) — server-fetched so the thread has no loading flash. */
async function loadComments(postId: string): Promise<CommentsPage> {
  try {
    const res = await fetchApi(`/posts/${encodeURIComponent(postId)}/comments?limit=20`);
    if (!res.ok) return EMPTY_COMMENTS_PAGE;
    return (await res.json()) as CommentsPage;
  } catch {
    return EMPTY_COMMENTS_PAGE;
  }
}

/** First page of the bsky-style "liked by" list — server-fetched, same as comments. */
async function loadLikes(postId: string): Promise<PostLikesPage> {
  try {
    const res = await fetchApi(`/posts/${encodeURIComponent(postId)}/likes?limit=30`);
    if (!res.ok) return EMPTY_POST_LIKES_PAGE;
    return (await res.json()) as PostLikesPage;
  } catch {
    return EMPTY_POST_LIKES_PAGE;
  }
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
  const { newerId, olderId } = await loadNeighbors(address, view.id);

  if (view.locked) {
    return (
      <LockedPostCard
        creatorAddress={address}
        creatorName={name}
        isAuthed={isAuthed}
        view={view}
        newerId={newerId}
        olderId={olderId}
      />
    );
  }

  const [initialComments, initialLikes] = await Promise.all([loadComments(view.id), loadLikes(view.id)]);
  return (
    <PostArticle
      creatorAddress={address}
      creatorName={name}
      view={view}
      newerId={newerId}
      olderId={olderId}
      isAuthed={isAuthed}
      isOwner={session.user?.did === view.creator.did}
      viewerDid={session.user?.did ?? null}
      viewerName={session.user?.displayName ?? null}
      viewerAvatarUrl={session.user?.avatarUrl ?? null}
      initialComments={initialComments}
      initialLikes={initialLikes}
    />
  );
}
