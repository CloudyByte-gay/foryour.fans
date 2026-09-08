"use client";

import { WifiOff } from "lucide-react";
import { useEffect, useState } from "react";

/**
 * WEB PHASE 15 — "a global fetch failure / offline treatment". Mounted once
 * in `Providers` (above every route's own content), so losing connectivity
 * is visible everywhere rather than only surfacing as a confusing per-widget
 * fetch error the next time something tries to load. `navigator.onLine`
 * seeds the initial render; the `online`/`offline` events keep it live —
 * both only ever run client-side, so this renders nothing during SSR/the
 * first paint (avoids a hydration mismatch) and nothing at all when online.
 */
export function OfflineBanner() {
  const [isOffline, setIsOffline] = useState(false);

  useEffect(() => {
    if (!navigator.onLine) setIsOffline(true);
    const goOffline = () => setIsOffline(true);
    const goOnline = () => setIsOffline(false);
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
    };
  }, []);

  if (!isOffline) return null;

  return (
    <div role="status" className="border-b border-warning/30 bg-warning/10 px-4 py-2">
      <p className="mx-auto flex max-w-4xl items-center gap-2 text-sm text-foreground">
        <WifiOff className="h-4 w-4 shrink-0 text-warning" aria-hidden />
        <span>You&rsquo;re offline. Some actions won&rsquo;t work until your connection comes back.</span>
      </p>
    </div>
  );
}
