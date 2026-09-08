"use client";

import { ShieldAlert } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "@/components/ui";
import { hasConfirmedAge } from "@/lib/ageVerification";
import { AgeGateDialog } from "./AgeGateDialog";

/**
 * Wraps a post's media/body when `containsAdultContent` is set — the
 * "precedes NSFW browsing" half of requirement #5 (the per-item blur +
 * "show anyway" is `MediaGallery`'s own, separate mechanism, still applied
 * underneath once this gate opens). Checked via `useEffect`, not a lazy
 * `useState` initializer, so server and first client render agree (both
 * "gated") and localStorage is only ever read client-side — the standard
 * way to avoid a hydration mismatch on a browser-storage-backed value.
 */
export function AdultContentGate({ children }: { children: ReactNode }) {
  const [confirmed, setConfirmed] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    if (hasConfirmedAge()) setConfirmed(true);
  }, []);

  if (confirmed) {
    return <>{children}</>;
  }

  return (
    <div className="mt-4 flex flex-col items-start gap-3 rounded-lg border border-border bg-surface-muted p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden />
        <div>
          <p className="font-medium">This post is marked as containing adult content</p>
          <p className="mt-0.5 text-muted">Confirm your age to view it.</p>
        </div>
      </div>
      <Button variant="secondary" size="sm" onClick={() => setDialogOpen(true)}>
        Confirm age
      </Button>

      <AgeGateDialog open={dialogOpen} onOpenChange={setDialogOpen} onConfirmed={() => setConfirmed(true)} />
    </div>
  );
}
