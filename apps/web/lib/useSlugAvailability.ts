"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch } from "./apiFetch";
import { validateSlugShape } from "./slug";

export type SlugStatus = "idle" | "checking" | "available" | "taken" | "error";

/**
 * Debounced slug availability check via `GET /creators/:identifier` (404 =
 * free, 200 = taken). `currentSlug` is treated as available so a creator can
 * "change" their slug to itself in the settings dialog without a false clash.
 */
export function useSlugAvailability(
  slug: string,
  options: { currentSlug?: string } = {},
): { status: SlugStatus; shapeError: string | null } {
  const { currentSlug } = options;
  const shapeError = slug.length > 0 ? validateSlugShape(slug) : null;
  const [status, setStatus] = useState<SlugStatus>("idle");
  const reqId = useRef(0);

  useEffect(() => {
    if (slug.length === 0 || shapeError) {
      setStatus("idle");
      return;
    }
    if (currentSlug && slug === currentSlug) {
      setStatus("available");
      return;
    }
    setStatus("checking");
    const id = ++reqId.current;
    const timer = setTimeout(async () => {
      try {
        const res = await apiFetch(`/creators/${encodeURIComponent(slug)}`);
        if (id !== reqId.current) return;
        setStatus(res.status === 404 ? "available" : res.ok ? "taken" : "error");
      } catch {
        if (id === reqId.current) setStatus("error");
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [slug, shapeError, currentSlug]);

  return { status, shapeError };
}
