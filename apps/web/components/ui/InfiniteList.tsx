"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { Button } from "./Button";
import { ErrorState } from "./ErrorState";
import { Spinner } from "./Spinner";

interface InfiniteListProps {
  /** Whether the API's cursor indicates more pages. */
  hasMore: boolean;
  /** A page request is in flight. */
  isLoading: boolean;
  /** Fetch the next page (drive this from the API cursor — requirement #9). */
  onLoadMore: () => void;
  /** Set when the last page request failed; shows an inline retry. */
  error?: boolean;
  /** Auto-load on scroll when the sentinel is visible. Defaults to true. */
  auto?: boolean;
  className?: string;
  children: React.ReactNode;
}

/**
 * Presentational helper for cursor-driven lists. It owns only the "load more"
 * affordance (button + optional scroll sentinel) and its loading/error states;
 * data fetching stays with the caller (TanStack Query in later phases).
 */
export function InfiniteList({
  hasMore,
  isLoading,
  onLoadMore,
  error = false,
  auto = true,
  className,
  children,
}: InfiniteListProps) {
  const sentinelRef = useRef<HTMLDivElement>(null);

  // WEB PHASE 15 — a screen-reader user hears "Loading" (the Spinner's own
  // label) while a page fetches, but nothing tells them it actually
  // finished and new content appeared — the visual page just grows. This
  // announces once per completed (non-error) load, independent of the
  // scroll-triggered vs. button-triggered path.
  const [announcement, setAnnouncement] = useState("");
  const wasLoading = useRef(false);
  useEffect(() => {
    if (wasLoading.current && !isLoading && !error) {
      setAnnouncement("More results loaded.");
    }
    wasLoading.current = isLoading;
  }, [isLoading, error]);

  useEffect(() => {
    if (!auto || !hasMore || isLoading || error) return;
    const node = sentinelRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onLoadMore();
      },
      { rootMargin: "400px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [auto, hasMore, isLoading, error, onLoadMore]);

  return (
    <div className={cn("space-y-4", className)}>
      <span aria-live="polite" className="sr-only">
        {announcement}
      </span>
      {children}

      {error && (
        <ErrorState
          title="Couldn't load more"
          message="The next page failed to load."
          onRetry={onLoadMore}
        />
      )}

      {!error && hasMore && (
        <div ref={sentinelRef} className="flex justify-center py-2">
          <Button variant="secondary" size="sm" onClick={onLoadMore} loading={isLoading}>
            {isLoading ? "Loading" : "Load more"}
          </Button>
        </div>
      )}

      {!error && !hasMore && isLoading && (
        <div className="flex justify-center py-2">
          <Spinner label="Loading" />
        </div>
      )}
    </div>
  );
}
