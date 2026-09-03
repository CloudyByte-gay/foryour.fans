"use client";

import Link from "next/link";
import { useState } from "react";
import { Avatar, Button, Textarea, toast } from "@/components/ui";
import { COMMENT_TEXT_MAX, postComment, type Comment } from "@/lib/comments";

/**
 * The composer half of the comment thread on `/c/:handle/post/:id` (WEB
 * PHASE 12). Only rendered by `CommentThread` for a signed-in viewer — the
 * backend requires a session for `POST /posts/:id/comments` regardless of
 * post visibility (even a PUBLIC post), so an anonymous viewer gets a
 * "log in to comment" prompt instead, never a composer that would just
 * 401 on submit.
 */
export function CommentComposer({
  postId,
  viewerName,
  viewerAvatarUrl,
  onPosted,
}: {
  postId: string;
  viewerName: string | null;
  viewerAvatarUrl: string | null;
  onPosted: (comment: Comment) => void;
}) {
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const trimmed = text.trim();
  const overLimit = trimmed.length > COMMENT_TEXT_MAX;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!trimmed || overLimit || submitting) return;
    setSubmitting(true);
    const outcome = await postComment(postId, trimmed);
    setSubmitting(false);
    if (!outcome.ok) {
      toast({ title: "Couldn't post your comment", description: outcome.message, variant: "error" });
      return;
    }
    setText("");
    onPosted(outcome.comment);
  }

  return (
    <form onSubmit={submit} className="flex gap-3">
      <Avatar src={viewerAvatarUrl} name={viewerName} size="sm" className="mt-0.5 shrink-0" />
      <div className="flex-1 space-y-2">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Add a comment…"
          rows={2}
          aria-label="Add a comment"
          maxLength={COMMENT_TEXT_MAX + 200}
          invalid={overLimit}
        />
        <div className="flex items-center justify-between">
          <span className={overLimit ? "text-xs text-danger" : "text-xs text-muted"}>
            {trimmed.length}/{COMMENT_TEXT_MAX}
          </span>
          <Button type="submit" size="sm" loading={submitting} disabled={!trimmed || overLimit}>
            Comment
          </Button>
        </div>
      </div>
    </form>
  );
}

/** The signed-out equivalent — a prompt instead of a composer, never a form that would 401. */
export function CommentLoginPrompt({ loginNext }: { loginNext: string }) {
  return (
    <p className="rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted">
      <Link href={`/login?next=${encodeURIComponent(loginNext)}`} className="text-primary hover:underline">
        Log in
      </Link>{" "}
      to leave a comment.
    </p>
  );
}
