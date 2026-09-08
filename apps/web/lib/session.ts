import "server-only";
import { cache } from "react";
import { fetchApi } from "./serverApi";

export type UserRole = "USER" | "ADMIN";
export type UserStatus = "ACTIVE" | "RESTRICTED";

/** Shape of `GET /me` (apps/api/src/routes/auth.ts). */
export interface SessionUser {
  did: string;
  handle: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  bannerUrl: string | null;
  /**
   * Phase 14 — `role` gates the web `/admin` link/entry client-side; the
   * server-side `requireAdmin` check on every `/admin/*` route is what
   * actually enforces access (a stray client bug here is never a real
   * authorization gap — a non-admin hitting `/admin` gets a real 404, not a
   * confirming 403, from the route's own layout check). `status` drives the
   * "your account is restricted" banner.
   */
  role: UserRole;
  status: UserStatus;
}

export type SessionStatus = "authenticated" | "anonymous";

export interface SessionState {
  status: SessionStatus;
  user: SessionUser | null;
}

/** Minimal `GET /creators/me` fields the shell needs (nav "Create"/"Dashboard", the suspended-creator banner). */
export interface OwnCreatorSummary {
  did: string;
  handle: string | null;
  status: "ACTIVE" | "SUSPENDED";
}

/**
 * Resolve the session on the server so the correct header variant is in the
 * first HTML (requirement #2 — no logged-out -> logged-in flicker).
 *
 * `cache()` dedupes this across the root layout, the (app) layout and the
 * Header within a single request, so `/me` is hit once per render.
 * A 401 or a transport failure both mean "anonymous" — never an error page.
 */
export const getSession = cache(async (): Promise<SessionState> => {
  try {
    const res = await fetchApi("/me");
    if (res.ok) {
      return { status: "authenticated", user: (await res.json()) as SessionUser };
    }
  } catch {
    // API unreachable — treat as logged out; marketing pages still render.
  }
  return { status: "anonymous", user: null };
});

/** Whether the current user has a creator account. `null` when not / on error. */
export const getOwnCreator = cache(async (): Promise<OwnCreatorSummary | null> => {
  try {
    const res = await fetchApi("/creators/me");
    if (res.ok) {
      return (await res.json()) as OwnCreatorSummary;
    }
  } catch {
    // ignore
  }
  return null;
});
