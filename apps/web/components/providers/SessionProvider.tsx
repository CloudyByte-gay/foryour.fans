"use client";

import { createContext, useContext, useEffect, useState } from "react";
import type { SessionState } from "@/lib/session";
import { onSessionCleared } from "@/lib/sessionSignal";

const ANONYMOUS: SessionState = { status: "anonymous", user: null };

const SessionContext = createContext<SessionState | null>(null);

/**
 * Holds the session resolved on the server (requirement #2). Hydrated once
 * from `initial` and never re-fetched on mount just to populate itself. It
 * *does* flip to anonymous when `emitSessionCleared()` fires (logout, or a
 * 401 caught by `apiFetch`), so client components stop showing logged-in UI
 * before the subsequent full-page redirect completes.
 */
export function SessionProvider({
  initial,
  children,
}: {
  initial: SessionState;
  children: React.ReactNode;
}) {
  const [session, setSession] = useState<SessionState>(initial);

  useEffect(() => onSessionCleared(() => setSession(ANONYMOUS)), []);

  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within <SessionProvider>");
  return ctx;
}
