"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getMediaAccess, type MediaAccess } from "@/lib/media";

type State =
  | { status: "loading" }
  | { status: "ready"; url: string }
  | { status: "locked" }
  | { status: "missing" }
  | { status: "error" };

/**
 * Resolves a media asset's bytes through `GET /media/:id/access` on demand
 * — a storage URL is never embedded directly (cross-cutting req #8). The
 * signed URL is treated as short-lived: this refreshes it a little before
 * `expiresAt`, and once more on an explicit `retry()`. A `locked` result is
 * the "subscribe to unlock" case and is surfaced, not retried.
 */
export function useSignedMedia(assetId: string, enabled = true): State & { retry: () => void } {
  const [state, setState] = useState<State>({ status: "loading" });
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const load = useCallback(async () => {
    setState({ status: "loading" });
    const result: MediaAccess = await getMediaAccess(assetId);
    if (result.ok) {
      setState({ status: "ready", url: result.url });
      const msUntilExpiry = new Date(result.expiresAt).getTime() - Date.now();
      // Refresh 10s early, but never sooner than 5s or on a bogus/expired value.
      const refreshIn = Math.max(5_000, msUntilExpiry - 10_000);
      clearTimeout(timer.current);
      if (Number.isFinite(refreshIn)) {
        timer.current = setTimeout(() => void load(), refreshIn);
      }
      return;
    }
    setState({ status: result.reason === "locked" ? "locked" : result.reason === "missing" ? "missing" : "error" });
  }, [assetId]);

  useEffect(() => {
    if (!enabled) return;
    void load();
    return () => clearTimeout(timer.current);
  }, [enabled, load]);

  return { ...state, retry: () => void load() };
}
