"use client";

import { ArrowLeft, Flag, MoreHorizontal, ShieldOff } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import {
  Badge,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui";
import { relativeTime } from "@/lib/format";
import { POST_VISIBILITY_META, bskyAppUrl, type UnlockedPostView } from "@/lib/post";
import type { CommentsPage } from "@/lib/comments";
import { MediaGallery } from "@/components/media/MediaGallery";
import { toGalleryItems } from "@/lib/mediaItems";
import { AdultContentGate } from "@/components/moderation/AdultContentGate";
import { BlockDialog } from "@/components/moderation/BlockDialog";
import { ContentLabelGate } from "@/components/moderation/ContentLabelGate";
import { ReportDialog } from "@/components/moderation/ReportDialog";
import type { PostLikesPage } from "@/lib/likes";
import { CommentThread } from "@/components/post/CommentThread";
import { LikeButton } from "@/components/post/LikeButton";
import { LikedByList } from "@/components/post/LikedByList";
import { PostNav } from "@/components/post/PostNav";

/** Report this post, or block its creator (WEB PHASE 14) — hidden for the post's own creator. */
function PostActionsMenu({ postId, creatorAddress, creatorName, creatorDid }: { postId: string; creatorAddress: string; creatorName: string; creatorDid: string }) {
  const [reportOpen, setReportOpen] = useState(false);
  const [blockOpen, setBlockOpen] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          className="ml-auto rounded p-1 text-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="Post actions"
        >
          <MoreHorizontal className="h-4 w-4" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setReportOpen(true)}>
            <Flag className="h-4 w-4" aria-hidden />
            Report post
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setBlockOpen(true)}>
            <ShieldOff className="h-4 w-4" aria-hidden />
            Block {creatorName}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ReportDialog open={reportOpen} onOpenChange={setReportOpen} subjectType="POST" subjectId={postId} subjectLabel="this post" />
      <BlockDialog open={blockOpen} onOpenChange={setBlockOpen} identifier={creatorAddress || creatorDid} name={creatorName} />
    </>
  );
}

/**
 * A fully-readable post — shown to an entitled viewer, the creator, or anyone
 * for a PUBLIC post. Body text is rendered as plain text with line breaks
 * preserved; it is never interpreted as HTML/markdown (see lib/post.ts).
 * `newerId`/`olderId` (WEB PHASE 9) render prev/next links within the
 * creator's feed; omit both when navigation isn't available. The like
 * control and comment thread (WEB PHASE 12) render unconditionally here —
 * this component is only ever reached for a post the viewer can already
 * see, so "access inherited from the post" (the backend's own rule) holds
 * by construction: `LockedPostCard` renders neither.
 */
export function PostArticle({
  creatorAddress,
  creatorName,
  view,
  newerId = null,
  olderId = null,
  isAuthed,
  isOwner,
  viewerDid,
  viewerName,
  viewerAvatarUrl,
  initialComments,
  initialLikes,
}: {
  creatorAddress: string;
  creatorName: string;
  view: UnlockedPostView;
  newerId?: string | null;
  olderId?: string | null;
  isAuthed: boolean;
  /** Whether the viewer is this post's own creator. */
  isOwner: boolean;
  /** WEB PHASE 14 — null when anonymous; hides report/block on the viewer's own comments. */
  viewerDid: string | null;
  viewerName: string | null;
  viewerAvatarUrl: string | null;
  initialComments: CommentsPage;
  /** First page of the bsky-style "liked by" list (GET /posts/:id/likes). */
  initialLikes: PostLikesPage;
}) {
  const meta = POST_VISIBILITY_META[view.visibility];
  const bskyLink = bskyAppUrl(view.bskyAtUri, view.creator.handle ?? view.creator.did);
  const loginNext = `/c/${creatorAddress}/post/${view.id}`;

  const body = (
    <>
      <div className="mt-4 whitespace-pre-line text-[15px] leading-relaxed">{view.text}</div>
      {view.media.length > 0 && (
        <MediaGallery items={toGalleryItems(view.media, { nsfw: view.containsAdultContent })} />
      )}
    </>
  );

  return (
    <article className="mx-auto max-w-2xl px-4 py-8">
      {/* Posts have no title (lib/post.ts) — a post's body isn't a heading
          candidate either (it's arbitrary, possibly-empty user text), so
          this gives the page the top-level heading landmark screen readers
          expect without visually duplicating the back-link right below it. */}
      <h1 className="sr-only">Post by {creatorName}</h1>
      <div className="flex items-center gap-2">
        <Link
          href={`/c/${creatorAddress}`}
          className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          {creatorName}
        </Link>
        {isAuthed && !isOwner && (
          <PostActionsMenu postId={view.id} creatorAddress={creatorAddress} creatorName={creatorName} creatorDid={view.creator.did} />
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Badge variant={meta.badge}>{meta.label}</Badge>
        {bskyLink && <Badge variant="primary">Bluesky</Badge>}
        {view.containsAdultContent && <Badge variant="danger">18+</Badge>}
        <span className="text-sm text-muted">{relativeTime(view.createdAt)}</span>
      </div>

      <ContentLabelGate labels={view.labels}>
        {view.containsAdultContent ? <AdultContentGate>{body}</AdultContentGate> : body}
      </ContentLabelGate>

      {bskyLink && (
        <p className="mt-8 border-t border-border pt-4 text-xs text-muted">
          {/* underline (not hover:underline) — this link sits inline with the
              "· published as ..." text right after it in the same <p>, so
              color alone isn't enough to distinguish it (WCAG 1.4.1). */}
          <a href={bskyLink} target="_blank" rel="noopener noreferrer" className="text-primary underline">
            View on Bluesky ↗
          </a>
          {view.sourceCollections && view.sourceCollections.length > 1 && (
            <span> · published as {view.sourceCollections.join(" + ")}</span>
          )}
        </p>
      )}

      {view.visibility !== "PUBLIC" && (
        <p className="mt-8 border-t border-border pt-4 text-xs text-muted">
          This post is only on foryour.fans — it is not published to Bluesky's network.
        </p>
      )}

      <div className="mt-6">
        <LikeButton
          postId={view.id}
          isAuthed={isAuthed}
          loginNext={loginNext}
          isOwner={isOwner}
          creatorName={creatorName}
          initialLikeCount={view.likeCount}
          initialLikedByViewer={view.likedByViewer}
          initialLikedByCreator={view.likedByCreator}
        />
        <LikedByList postId={view.id} initialPage={initialLikes} />
      </div>

      <CommentThread
        postId={view.id}
        initialPage={initialComments}
        creatorDid={view.creator.did}
        isAuthed={isAuthed}
        loginNext={loginNext}
        viewerDid={viewerDid}
        viewerName={viewerName}
        viewerAvatarUrl={viewerAvatarUrl}
      />

      <PostNav creatorAddress={creatorAddress} newerId={newerId} olderId={olderId} />
    </article>
  );
}
