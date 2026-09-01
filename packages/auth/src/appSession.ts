import { randomBytes } from "node:crypto";
import type { Did } from "@foryour-fans/shared";
import type { Redis } from "ioredis";

const SESSION_KEY_PREFIX = "app:session:";

export const APP_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

export interface AppSessionData {
  did: Did;
  csrfToken: string;
  createdAt: string;
}

function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Our application's own login session — separate from the atproto OAuth
 * grant (see atprotoStores.ts). The cookie only ever holds this opaque
 * session ID; all session data (including the CSRF token) lives
 * server-side in Redis, so a session can be revoked immediately and
 * enumerated/audited without trusting anything the client sends except the
 * ID itself.
 */
export async function createAppSession(redis: Redis, did: Did): Promise<{ sessionId: string; session: AppSessionData }> {
  const sessionId = generateToken();
  const session: AppSessionData = {
    did,
    csrfToken: generateToken(),
    createdAt: new Date().toISOString(),
  };
  await redis.set(SESSION_KEY_PREFIX + sessionId, JSON.stringify(session), "EX", APP_SESSION_TTL_SECONDS);
  return { sessionId, session };
}

export async function getAppSession(redis: Redis, sessionId: string): Promise<AppSessionData | null> {
  const raw = await redis.get(SESSION_KEY_PREFIX + sessionId);
  return raw ? (JSON.parse(raw) as AppSessionData) : null;
}

export async function destroyAppSession(redis: Redis, sessionId: string): Promise<void> {
  await redis.del(SESSION_KEY_PREFIX + sessionId);
}
