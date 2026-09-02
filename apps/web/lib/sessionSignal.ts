/**
 * A tiny pub/sub so non-React code (the `apiFetch` wrapper, the logout
 * helper) can tell `SessionProvider` to drop to the anonymous state without
 * a full reload. Client-only.
 */
type Listener = () => void;

const listeners = new Set<Listener>();

/** Subscribe; returns an unsubscribe function. */
export function onSessionCleared(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Notify subscribers that the session is gone (expired or logged out). */
export function emitSessionCleared(): void {
  for (const listener of listeners) listener();
}
