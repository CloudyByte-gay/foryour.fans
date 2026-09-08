"use client";

import { EyeOff, ShieldAlert } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui";
import { hasNonDismissibleLabel, labelMeta } from "@/lib/contentLabels";

/**
 * Content-label display (WEB PHASE 14) — collapses `children` behind a
 * notice when `labels` (moderator/classifier-applied `ContentLabel` values,
 * `GET /posts/:id`'s `labels` field) is non-empty. A dismissible label shows
 * a "Show anyway" control; a non-dismissible one (currently just
 * `takedown` — see lib/contentLabels.ts) never reveals `children` at all.
 *
 * Distinct from the NSFW media blur (`containsAdultContent`,
 * lib/mediaItems.ts#toGalleryItems) — that's a creator-declared flag on the
 * whole post; this is a moderator decision that can apply independently of
 * it, and defaults to collapsing the entire body, not just media.
 */
export function ContentLabelGate({ labels, children }: { labels: string[]; children: ReactNode }) {
  const [revealed, setRevealed] = useState(false);

  if (labels.length === 0) {
    return <>{children}</>;
  }

  if (hasNonDismissibleLabel(labels)) {
    const metas = labels.map(labelMeta);
    return (
      <div role="note" className="flex items-start gap-3 rounded-lg border border-danger/30 bg-danger/5 p-4 text-sm">
        <EyeOff className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden />
        <div>
          <p className="font-medium text-danger">{metas[0]!.displayName}</p>
          <p className="mt-0.5 text-muted">{metas[0]!.description}</p>
        </div>
      </div>
    );
  }

  if (!revealed) {
    const metas = labels.map(labelMeta);
    return (
      <div role="note" className="flex flex-col items-start gap-3 rounded-lg border border-border bg-surface-muted p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden />
          <div>
            <p className="font-medium">Labeled: {metas.map((m) => m.displayName).join(", ")}</p>
            <p className="mt-0.5 text-muted">{metas[0]!.description}</p>
          </div>
        </div>
        <Button variant="secondary" size="sm" onClick={() => setRevealed(true)}>
          Show anyway
        </Button>
      </div>
    );
  }

  return <>{children}</>;
}
