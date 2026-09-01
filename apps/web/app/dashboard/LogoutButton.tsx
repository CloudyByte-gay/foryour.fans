"use client";

// Must match packages/auth's CSRF_COOKIE_NAME. Not importing that constant
// directly — packages/auth pulls in ioredis/@prisma/client, which must
// never end up in a browser bundle.
const CSRF_COOKIE_NAME = "ff_csrf";

function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

export function LogoutButton() {
  async function handleLogout() {
    const csrfToken = readCookie(CSRF_COOKIE_NAME);
    await fetch("/api/auth/logout", {
      method: "POST",
      headers: csrfToken ? { "x-csrf-token": csrfToken } : {},
    });
    window.location.href = "/";
  }

  return <button onClick={() => void handleLogout()}>Log out</button>;
}
