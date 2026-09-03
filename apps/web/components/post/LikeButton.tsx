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
 * The like control on `/c/:handle/post/:id` (WEB PHASE 12). Optimistic
 * toggle with rollback on error, a running count, and a "liked by creator"
 * indicator sourced from `GET /posts/:id`'s `likedByCreator` field
 * (`getLikeSummary`, apps/api/src/routes/posts.ts) — there's no
 * `GET /posts/:id/likes` route, so that field only ever comes from the
 * initial post fetch; a toggle here only ever confirms `likeCount`/
 * `likedByViewer` from the server, and `likedByCreator` is derived locally
 * (it can only change from the *creator's own* toggle — see `isOwner` below).
 */
export function LikeButton({
  postId,
  isAuthed,
  loginNext,
  isOwner,
  creatorName,
  initialLikeCount,
  initialLikedByViewer,
  initialLikedByCreator,
}: {
  postId: string;
  isAuthed: boolean;
  loginNext: string;
  /** Whether the viewer *is* the post's creator — the only case where liking changes `likedByCreator`. */
  isOwner: boolean;
  creatorName: string;
  initialLikeCount: number;
  initialLikedByViewer: boolean;
  initialLikedByCreator: boolean;
}) {
  const [state, setState] = useState<LikeButtonState>({
    likeCount: initialLikeCount,
    likedByViewer: initialLikedByViewer,
    likedByCreator: initialLikedByCreator,
  });
  const [pending, setPending] = useState(false);

  const countLabel = state.likeCount > 0 ? String(state.likeCount) : "Like";

  if (!isAuthed) {
    return (
      <div className="flex items-center gap-2">
        <Link
          href={`/login?next=${encodeURIComponent(loginNext)}`}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-sm text-foreground hover:bg-surface-muted"
        >
          <Heart className="h-4 w-4" aria-hidden />
          {countLabel}
        </Link>
        {state.likedByCreator && (
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
