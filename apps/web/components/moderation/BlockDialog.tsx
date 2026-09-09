"use client";

import { useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  toast,
} from "@/components/ui";
import { blockUser } from "@/lib/blocks";

/**
 * The block confirmation dialog (WEB PHASE 14) — used for both "block user"
 * and "block creator" from the viewer's own perspective (see lib/blocks.ts's
 * doc comment on why both go through the same generic endpoint). Blocking
 * publishes a real `app.bsky.graph.block` record, so the confirmation copy
 * says so rather than implying an app-only preference toggle.
 */
export function BlockDialog({
  open,
  onOpenChange,
  identifier,
  name,
  onBlocked,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Handle or DID — the same identifier `POST /blocks` takes. */
  identifier: string;
  name: string;
  onBlocked?: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setSubmitting(true);
    setError(null);
    const outcome = await blockUser(identifier);
    setSubmitting(false);
    if (!outcome.ok) {
      setError(outcome.message);
      return;
    }
    onOpenChange(false);
    onBlocked?.();
    toast({ title: `Blocked ${name}`, description: "You won't see their content, and they can't interact with you." });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !submitting && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Block {name}?</DialogTitle>
          <DialogDescription>
            You&rsquo;ll no longer see their comments, and they won&rsquo;t be able to comment on,
            like, or subscribe to your content. This is a real Bluesky block record (AT Protocol),
            so it also applies on Bluesky and any other compatible app. You can unblock them
            anytime from{" "}
            <span className="font-medium text-foreground">Settings → Blocks</span>.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <p role="alert" className="text-sm font-medium text-danger">
            {error}
          </p>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={confirm} loading={submitting}>
            Block
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
