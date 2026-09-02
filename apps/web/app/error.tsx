"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/ui";

/** Catches render/data errors in any route segment (requirement #3). */
export default function GlobalError({
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
    <div className="mx-auto flex min-h-dvh max-w-md items-center px-4">
      <ErrorState
        title="Something broke"
        message="An unexpected error occurred. You can try again, or head back home."
        onRetry={reset}
        className="w-full"
      />
    </div>
  );
}
