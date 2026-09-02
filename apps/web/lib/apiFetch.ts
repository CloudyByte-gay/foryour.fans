import { toast } from "@/components/ui";
import { emitSessionCleared } from "./sessionSignal";

let expiryHandled = false;

/**
 * Client-side fetch to the app API (`/api/*`, same-origin so the session
 * cookie rides along). On a `401` it clears the session context, shows a
 * toast, and bounces to `/login?next=<current>` — the session-expiry
 * handling required in WEB PHASE 2. All other responses are returned as-is
 * for the caller to handle.
 *
 * `path` is relative to the API root, e.g. `apiFetch("/creators/me")`.
 */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`/api${path}`, {
    credentials: "same-origin",
    ...init,
  });

  if (res.status === 401 && typeof window !== "undefined") {
    handleExpiry();
  }

  return res;
}

function handleExpiry(): void {
  const path = window.location.pathname;
  // Already on the login page (or mid-redirect) — don't loop.
  if (path === "/login" || expiryHandled) return;
  expiryHandled = true;

  emitSessionCleared();
  toast({
    title: "Your session expired",
    description: "Please sign in again.",
    variant: "warning",
  });

  const next = window.location.pathname + window.location.search;
  window.location.assign(`/login?next=${encodeURIComponent(next)}`);
}
