"use client";

import { csrfHeaders } from "../../lib/csrf";

export function LogoutButton() {
  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST", headers: csrfHeaders() });
    window.location.href = "/";
  }

  return <button onClick={() => void handleLogout()}>Log out</button>;
}
