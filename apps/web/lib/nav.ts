/**
 * A `?next=` target is only honored if it's a path on this site. Rejects
 * absolute URLs, protocol-relative `//evil.com`, and anything under `/api`
 * (the backend proxy) — an open-redirect guard for the login flow.
 */
export function isSafeInternalPath(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  if (!value.startsWith("/")) return false;
  if (value.startsWith("//") || value.startsWith("/\\")) return false;
  if (value === "/api" || value.startsWith("/api/")) return false;
  if (value.startsWith("/auth/")) return false;
  return true;
}

/** Falls back to `/dashboard` when `value` isn't a safe internal path. */
export function safeNextOr(value: unknown, fallback = "/dashboard"): string {
  return isSafeInternalPath(value) ? value : fallback;
}

/**
 * Only `http:`/`https:` URLs are safe to render in an `<a href>`. Fields
 * like a creator's website come from an AT Protocol record the web app
 * doesn't control the writer of — a `javascript:` URI written via any other
 * AT client would otherwise execute in a visitor's browser on this origin.
 */
export function isSafeExternalUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Where the user should return after signing in. Stashed in sessionStorage
 * (not a query param on the OAuth round trip — the API's `?next=` isn't
 * threaded through the authorization-server redirect) and read back on
 * `/auth/callback`. sessionStorage survives the full-page navigation to the
 * PDS and back because it's same-origin, same-tab.
 */
const POST_LOGIN_NEXT_KEY = "ff.postLoginNext";

export function storePostLoginNext(next: string | undefined): void {
  try {
    if (isSafeInternalPath(next)) {
      window.sessionStorage.setItem(POST_LOGIN_NEXT_KEY, next);
    } else {
      window.sessionStorage.removeItem(POST_LOGIN_NEXT_KEY);
    }
  } catch {
    // sessionStorage unavailable (private mode etc.) — the flow still works,
    // it just lands on the default destination.
  }
}

export function takePostLoginNext(): string | null {
  try {
    const value = window.sessionStorage.getItem(POST_LOGIN_NEXT_KEY);
    window.sessionStorage.removeItem(POST_LOGIN_NEXT_KEY);
    return isSafeInternalPath(value) ? value : null;
  } catch {
    return null;
  }
}
