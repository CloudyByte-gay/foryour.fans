"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/ui";

/**
 * WEB PHASE 15 — a per-segment error boundary. Next.js instantiates a fresh
 * copy of whatever this default-exports for each route directory that has
 * an `error.tsx` (even though they all re-export this same component), so a
 * crash in one route's tree is caught there instead of unmounting the
 * entire app up to the root `app/error.tsx` — the shell (header/nav) stays
 * mounted and the visitor can navigate away without a full reload.
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface for whatever logging the deploy wires up (WEB PHASE 16).
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-2xl px-4 py-16">
      <ErrorState
        title="Couldn't load this page"
        message="Something went wrong loading this page. You can try again."
        onRetry={reset}
      />
    </div>
  );
}
