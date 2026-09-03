"use client";

import { Flag, MessageCircle } from "lucide-react";
import { useCallback, useState } from "react";
import { Avatar, Badge, EmptyState, InfiniteList, toast } from "@/components/ui";
import { relativeTime } from "@/lib/format";
import { fetchComments, type Comment, type CommentsPage } from "@/lib/comments";
import { CommentComposer, CommentLoginPrompt } from "./CommentComposer";

function authorName(author: Comment["author"]): string {
  return author.displayName ?? `@${author.handle ?? author.did}`;
}

/** Entry point only — the report dialog itself is WEB PHASE 14's job (Report/ModerationCase). */
function ReportCommentButton({ authorName: name }: { authorName: string }) {
  return (
    <button
      type="button"
      onClick={() =>
        toast({
          title: "Reporting isn't available yet",
          description: "Flagging a comment for review is coming in a future update.",
        })
      }
      className="text-muted hover:text-foreground"
      aria-label={`Report comment by ${name}`}
      title="Report"
    >
      <Flag className="h-3.5 w-3.5" aria-hidden />
    </button>
  );
}

function CommentRow({ comment, isCreator }: { comment: Comment; isCreator: boolean }) {
  const name = authorName(comment.author);
  return (
    <div className="flex gap-3">
      <Avatar src={comment.author.avatarUrl} name={name} size="sm" className="shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm font-medium">{name}</span>
          {isCreator && <Badge variant="primary">Creator</Badge>}
          <span className="text-xs text-muted">{relativeTime(comment.createdAt)}</span>
          <span className="ml-auto">
            <ReportCommentButton authorName={name} />
          </span>
        </div>
        <p className="mt-0.5 whitespace-pre-line text-sm leading-relaxed">{comment.text}</p>
      </div>
    </div>
  );
}

/**
 * Comment thread on `/c/:handle/post/:id` (WEB PHASE 12). Only ever rendered
 * for a post the viewer already has access to — `PostArticle` never renders
 * this for a locked post, so there's no separate entitlement check here; a
 * `403` from a mid-view entitlement lapse (e.g. a canceled subscription)
 * just surfaces through `apiFetch`'s normal error handling on the next
 * action, same as everywhere else.
 *
 * Oldest-first, same order the API returns (`GET /posts/:id/comments` —
 * "natural reading order for a discussion thread", see
 * packages/content/src/comments.ts). A newly-posted comment is always the
 * newest thing that exists, so it's appended to the end of whatever's
 * currently loaded regardless of how many pages have been fetched.
 */
export function CommentThread({
  postId,
  initialPage,
  creatorDid,
  isAuthed,
  loginNext,
  viewerName,
  viewerAvatarUrl,
}: {
  postId: string;
  initialPage: CommentsPage;
  creatorDid: string;
  isAuthed: boolean;
  loginNext: string;
  viewerName: string | null;
  viewerAvatarUrl: string | null;
}) {
  const [comments, setComments] = useState<Comment[]>(initialPage.comments);
  const [cursor, setCursor] = useState<string | null>(initialPage.nextCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState(false);

  const loadMore = useCallback(async () => {
    if (!cursor) return;
    setLoadingMore(true);
    setMoreError(false);
    try {
      const page = await fetchComments(postId, cursor);
      setComments((prev) => [...prev, ...page.comments]);
      setCursor(page.nextCursor);
    } catch {
      setMoreError(true);
    } finally {
      setLoadingMore(false);
    }
  }, [postId, cursor]);

  const handlePosted = useCallback((comment: Comment) => {
    setComments((prev) => [...prev, comment]);
  }, []);

  return (
    <section className="mt-8 space-y-4 border-t border-border pt-6" aria-labelledby="comments-heading">
      <h2 id="comments-heading" className="flex items-center gap-2 font-display text-base font-semibold">
        <MessageCircle className="h-4 w-4" aria-hidden />
        Comments
      </h2>

      {comments.length === 0 ? (
        <EmptyState
          icon={MessageCircle}
          title="No comments yet"
          description={isAuthed ? "Be the first to say something." : "Log in to be the first to say something."}
        />
      ) : (
        <InfiniteList hasMore={cursor !== null} isLoading={loadingMore} onLoadMore={loadMore} error={moreError}>
          {comments.map((comment) => (
            <CommentRow key={comment.id} comment={comment} isCreator={comment.author.did === creatorDid} />
          ))}
        </InfiniteList>
      )}

      {isAuthed ? (
        <CommentComposer postId={postId} viewerName={viewerName} viewerAvatarUrl={viewerAvatarUrl} onPosted={handlePosted} />
      ) : (
        <CommentLoginPrompt loginNext={loginNext} />
      )}
    </section>
  );
}
