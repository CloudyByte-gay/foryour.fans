import { csrfHeaders } from "./csrf";
import { emitSessionCleared } from "./sessionSignal";

/**
 * Log the current user out: CSRF-protected `POST /auth/logout`, clear the
 * client session context, then a full-page navigation to `/` so the server
 * re-renders the logged-out shell. Resolves to `true` on success.
 *
 * Uses a plain `fetch` (not `apiFetch`) — a 401 here just means the session
 * was already gone, which is a successful logout, not an expiry to react to.
 */
export async function logout(): Promise<boolean> {
  let ok = false;
  try {
    const res = await fetch("/api/auth/logout", { method: "POST", headers: csrfHeaders() });
    ok = res.ok || res.status === 204 || res.status === 401;
  } catch {
    ok = false;
  }

  emitSessionCleared();
  if (ok && typeof window !== "undefined") {
    window.location.assign("/");
  }
  return ok;
}
