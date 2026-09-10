"use client";

import { Heart } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button, toast } from "@/components/ui";
import { cn } from "@/lib/cn";
import { likePost, unlikePost } from "@/lib/likes";

interface LikeButtonState {
  likeCount: number;
  likedByViewer: boolean;
  likedByCreator: boolean;
}

/**
 * The like control. `variant="full"` (default) — the single-post view
 * (WEB PHASE 12): a running count, optimistic toggle with rollback, and a
 * "liked by creator" indicator from `GET /posts/:id`'s `likedByCreator`.
 * `variant="compact"` — a feed / profile card: heart + count only, fed by
 * the feed response's `likeCount`/`likedByViewer` enrichment. Both share the
 * same optimistic toggle against `POST`/`DELETE /posts/:id/likes`.
 */
export function LikeButton({
  postId,
  isAuthed,
  loginNext,
  isOwner = false,
  creatorName = "",
  initialLikeCount,
  initialLikedByViewer,
  initialLikedByCreator = false,
  variant = "full",
}: {
  postId: string;
  isAuthed: boolean;
  loginNext: string;
  /** Whether the viewer *is* the post's creator — the only case where liking changes `likedByCreator`. */
  isOwner?: boolean;
  creatorName?: string;
  initialLikeCount: number;
  initialLikedByViewer: boolean;
  initialLikedByCreator?: boolean;
  variant?: "full" | "compact";
}) {
  const [state, setState] = useState<LikeButtonState>({
    likeCount: initialLikeCount,
    likedByViewer: initialLikedByViewer,
    likedByCreator: initialLikedByCreator,
  });
  const [pending, setPending] = useState(false);

  const compact = variant === "compact";
  const countLabel = state.likeCount > 0 ? String(state.likeCount) : "Like";

  if (!isAuthed) {
    return (
      <div className="flex items-center gap-2">
        <Link
          href={`/login?next=${encodeURIComponent(loginNext)}`}
          aria-label={`Like this post — ${state.likeCount} ${state.likeCount === 1 ? "like" : "likes"}`}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md text-foreground hover:bg-surface-muted",
            compact
              ? "h-7 px-2 text-xs text-muted hover:text-foreground"
              : "h-8 border border-border px-3 text-sm",
          )}
        >
          <Heart className={cn(compact ? "h-3.5 w-3.5" : "h-4 w-4")} aria-hidden />
          {countLabel}
        </Link>
        {!compact && state.likedByCreator && (
          <span className="text-xs text-muted">Liked by {creatorName}</span>
        )}
      </div>
    );
  }

  async function toggle() {
    if (pending) return;
    const previous = state;
    const wasLiked = previous.likedByViewer;
    setPending(true);
    setState({
      likeCount: previous.likeCount + (wasLiked ? -1 : 1),
      likedByViewer: !wasLiked,
      likedByCreator: isOwner ? !wasLiked : previous.likedByCreator,
    });

    const outcome = wasLiked ? await unlikePost(postId) : await likePost(postId);
    setPending(false);

    if (!outcome.ok) {
      setState(previous);
      toast({ title: "Couldn't update your like", description: outcome.message, variant: "error" });
      return;
    }
    setState({
      likeCount: outcome.likeCount,
      likedByViewer: outcome.likedByViewer,
      likedByCreator: isOwner ? outcome.likedByViewer : previous.likedByCreator,
    });
  }

  if (compact) {
    return (
      <button
        type="button"
        onClick={toggle}
        disabled={pending}
        aria-pressed={state.likedByViewer}
        aria-label={`${state.likedByViewer ? "Unlike" : "Like"} this post — ${state.likeCount} ${state.likeCount === 1 ? "like" : "likes"}`}
        className={cn(
          "inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs transition-colors",
          state.likedByViewer ? "text-primary" : "text-muted hover:text-foreground",
          pending && "opacity-60",
        )}
      >
        <Heart className={cn("h-3.5 w-3.5", state.likedByViewer && "fill-current")} aria-hidden />
        {countLabel}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant={state.likedByViewer ? "primary" : "secondary"}
        size="sm"
        onClick={toggle}
        disabled={pending}
        aria-pressed={state.likedByViewer}
      >
        <Heart className={cn("h-4 w-4", state.likedByViewer && "fill-current")} aria-hidden />
        {countLabel}
      </Button>
      {state.likedByCreator && !isOwner && (
        <span className="text-xs text-muted">Liked by {creatorName}</span>
      )}
    </div>
  );
}
