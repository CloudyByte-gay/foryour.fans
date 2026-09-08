"use client";

import { Flag, MessageCircle, MoreHorizontal, ShieldOff } from "lucide-react";
import { useCallback, useState } from "react";
import {
  Avatar,
  Badge,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  InfiniteList,
} from "@/components/ui";
import { relativeTime } from "@/lib/format";
import { fetchComments, type Comment, type CommentsPage } from "@/lib/comments";
import { BlockDialog } from "@/components/moderation/BlockDialog";
import { ReportDialog } from "@/components/moderation/ReportDialog";
import { CommentComposer, CommentLoginPrompt } from "./CommentComposer";

function authorName(author: Comment["author"]): string {
  return author.displayName ?? `@${author.handle ?? author.did}`;
}

/** The "..." menu on a comment — report it, or block its author (WEB PHASE 14). Hidden on the viewer's own comment. */
function CommentActionsMenu({ comment, name }: { comment: Comment; name: string }) {
  const [reportOpen, setReportOpen] = useState(false);
  const [blockOpen, setBlockOpen] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          className="rounded p-1 text-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`Actions for comment by ${name}`}
        >
          <MoreHorizontal className="h-3.5 w-3.5" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setReportOpen(true)}>
            <Flag className="h-4 w-4" aria-hidden />
            Report comment
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setBlockOpen(true)}>
            <ShieldOff className="h-4 w-4" aria-hidden />
            Block {name}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ReportDialog
        open={reportOpen}
        onOpenChange={setReportOpen}
        subjectType="COMMENT"
        subjectId={comment.id}
        subjectLabel="this comment"
      />
      <BlockDialog open={blockOpen} onOpenChange={setBlockOpen} identifier={comment.author.did} name={name} />
    </>
  );
}

function CommentRow({
  comment,
  isCreator,
  isAuthed,
  isOwnComment,
}: {
  comment: Comment;
  isCreator: boolean;
  isAuthed: boolean;
  isOwnComment: boolean;
}) {
  const name = authorName(comment.author);
  return (
    <div className="flex gap-3">
      <Avatar src={comment.author.avatarUrl} name={name} size="sm" className="shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm font-medium">{name}</span>
          {isCreator && <Badge variant="primary">Creator</Badge>}
          <span className="text-xs text-muted">{relativeTime(comment.createdAt)}</span>
          {isAuthed && !isOwnComment && (
            <span className="ml-auto">
              <CommentActionsMenu comment={comment} name={name} />
            </span>
          )}
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
  viewerDid,
  viewerName,
  viewerAvatarUrl,
}: {
  postId: string;
  initialPage: CommentsPage;
  creatorDid: string;
  isAuthed: boolean;
  loginNext: string;
  /** WEB PHASE 14 — hides report/block actions on the viewer's own comment. Null when anonymous. */
  viewerDid: string | null;
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
            <CommentRow
              key={comment.id}
              comment={comment}
              isCreator={comment.author.did === creatorDid}
              isAuthed={isAuthed}
              isOwnComment={viewerDid !== null && comment.author.did === viewerDid}
            />
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
