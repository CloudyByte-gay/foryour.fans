import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui";
import { relativeTime } from "@/lib/format";
import { POST_VISIBILITY_META, bskyAppUrl, type UnlockedPostView } from "@/lib/post";
import type { CommentsPage } from "@/lib/comments";
import { MediaGallery } from "@/components/media/MediaGallery";
import { toGalleryItems } from "@/lib/mediaItems";
import { CommentThread } from "@/components/post/CommentThread";
import { LikeButton } from "@/components/post/LikeButton";
import { PostNav } from "@/components/post/PostNav";

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
  viewerName,
  viewerAvatarUrl,
  initialComments,
}: {
  creatorAddress: string;
  creatorName: string;
  view: UnlockedPostView;
  newerId?: string | null;
  olderId?: string | null;
  isAuthed: boolean;
  /** Whether the viewer is this post's own creator. */
  isOwner: boolean;
  viewerName: string | null;
  viewerAvatarUrl: string | null;
  initialComments: CommentsPage;
}) {
  const meta = POST_VISIBILITY_META[view.visibility];
  const bskyLink = bskyAppUrl(view.bskyAtUri, view.creator.handle ?? view.creator.did);
  const loginNext = `/c/${creatorAddress}/post/${view.id}`;

  return (
    <article className="mx-auto max-w-2xl px-4 py-8">
      <Link
        href={`/c/${creatorAddress}`}
        className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        {creatorName}
      </Link>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Badge variant={meta.badge}>{meta.label}</Badge>
        {bskyLink && <Badge variant="primary">Bluesky</Badge>}
        <span className="text-sm text-muted">{relativeTime(view.createdAt)}</span>
      </div>

      <div className="mt-4 whitespace-pre-line text-[15px] leading-relaxed">{view.text}</div>

      {view.media.length > 0 && <MediaGallery items={toGalleryItems(view.media)} />}

      {bskyLink && (
        <p className="mt-8 border-t border-border pt-4 text-xs text-muted">
          <a href={bskyLink} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
            View on Bluesky ↗
          </a>
          {view.sourceCollections && view.sourceCollections.length > 1 && (
            <span> · published as {view.sourceCollections.join(" + ")}</span>
          )}
        </p>
      )}

      {view.visibility !== "PUBLIC" && (
        <p className="mt-8 border-t border-border pt-4 text-xs text-muted">
          This post is only on foryour.fans — it is not published to the AT Protocol network.
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
      </div>

      <CommentThread
        postId={view.id}
        initialPage={initialComments}
        creatorDid={view.creator.did}
        isAuthed={isAuthed}
        loginNext={loginNext}
        viewerName={viewerName}
        viewerAvatarUrl={viewerAvatarUrl}
      />

      <PostNav creatorAddress={creatorAddress} newerId={newerId} olderId={olderId} />
    </article>
  );
}
