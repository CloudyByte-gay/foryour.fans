/**
 * A `?next=` target is only honored if it's a path on this site. Rejects
 * absolute URLs, protocol-relative `//evil.com`, and anything under `/api`
 * (the backend proxy) — an open-redirect guard for the login flow.
 */
export function isSafeInternalPath(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  if (!value.startsWith("/")) return false;
  // Browsers strip tabs/newlines and normalize backslashes and dot segments.
  // Validate the resolved destination, including encoded route separators.
  if (hasUnsafePathCharacters(value)) return false;
  try {
    const base = "https://internal.invalid";
    const url = new URL(value, base);
    if (url.origin !== base) return false;
    const decoded = decodeURIComponent(url.pathname);
    if (hasUnsafePathCharacters(decoded) || decoded.startsWith("//")) return false;
    const path = new URL(decoded, base).pathname;
    return !["/api", "/auth", "/login"].some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
  } catch {
    return false;
  }
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

/** Non-destructive read for retry UI, which React may render repeatedly. */
export function peekPostLoginNext(): string | null {
  try {
    const value = window.sessionStorage.getItem(POST_LOGIN_NEXT_KEY);
    return isSafeInternalPath(value) ? value : null;
  } catch {
    return null;
  }
}

function hasUnsafePathCharacters(value: string): boolean {
  return Array.from(value).some((char) => char === "\\" || char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127);
}
