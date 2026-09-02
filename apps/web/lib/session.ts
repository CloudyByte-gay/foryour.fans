import "server-only";
import { cache } from "react";
import { fetchApi } from "./serverApi";

/** Shape of `GET /me` (apps/api/src/routes/auth.ts). */
export interface SessionUser {
  did: string;
  handle: string | null;
  displayName: string | null;
  avatarUrl: string | null;
}

export type SessionStatus = "authenticated" | "anonymous";

export interface SessionState {
  status: SessionStatus;
  user: SessionUser | null;
}

/** Minimal `GET /creators/me` fields the shell needs (nav "Create"/"Dashboard"). */
export interface OwnCreatorSummary {
  slug: string;
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
