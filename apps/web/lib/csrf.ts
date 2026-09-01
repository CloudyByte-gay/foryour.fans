// Must match packages/auth's CSRF_COOKIE_NAME. Not importing that constant
// directly — packages/auth pulls in ioredis/@prisma/client, which must
// never end up in a browser bundle. Client-side only (reads document.cookie).
const CSRF_COOKIE_NAME = "ff_csrf";

export function readCsrfToken(): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${CSRF_COOKIE_NAME}=([^;]*)`));
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

export function csrfHeaders(): HeadersInit {
  const token = readCsrfToken();
  return token ? { "x-csrf-token": token } : {};
}
