"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * WEB PHASE 15 — "focus management on route change". The App Router does
 * not move focus on navigation by itself (unlike a traditional full-page
 * load, where focus resets to the top of the document); left alone, a
 * screen-reader or keyboard user who navigates via `<Link>` keeps focus
 * wherever it was on the PREVIOUS page (often a now-detached or
 * unrelated element), with no cue that the page changed at all.
 *
 * Moves focus to the route's `#main-content` landmark (see the `(app)`/
 * `(marketing)` layouts' `<main>`) on every pathname change after the
 * first — the initial page load already puts focus at the top of the
 * document natively, so re-focusing on mount would be redundant (and
 * would steal focus from a same-page anchor like `#hash`).
 */
export function RouteFocusManager() {
  const pathname = usePathname();
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    // A handful of routes deliberately autofocus their own first field (e.g.
    // the post composer) — that happens synchronously before this passive
    // effect runs, so by the time we get here `document.activeElement` is
    // already that field, not `<body>`. Respect it instead of stealing focus
    // back to the landmark; only take over when nothing claimed it, which is
    // the ordinary case (the previous page's focused element just unmounted).
    if (document.activeElement && document.activeElement !== document.body) return;
    document.getElementById("main-content")?.focus();
  }, [pathname]);

  return null;
}
