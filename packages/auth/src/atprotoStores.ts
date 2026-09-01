import type { PrismaClient } from "@foryour-fans/database";
import type { NodeSavedSession, NodeSavedState } from "@atproto/oauth-client-node";
import type { Redis } from "ioredis";

const STATE_KEY_PREFIX = "atproto:oauth:state:";
// The AS-side authorization request (PAR) this guards is short-lived by
// design — if a login isn't completed within this window, the flow should
// simply fail and the user retries, rather than the state living forever.
const STATE_TTL_SECONDS = 10 * 60;

/**
 * NodeOAuthClient's "stateStore": short-lived CSRF/PKCE state for a single
 * in-flight authorization request. Redis-backed so it expires on its own.
 */
export function createRedisStateStore(redis: Redis): {
  get(key: string): Promise<NodeSavedState | undefined>;
  set(key: string, value: NodeSavedState): Promise<void>;
  del(key: string): Promise<void>;
} {
  return {
    async get(key) {
      const raw = await redis.get(STATE_KEY_PREFIX + key);
      return raw ? (JSON.parse(raw) as NodeSavedState) : undefined;
    },
    async set(key, value) {
      await redis.set(STATE_KEY_PREFIX + key, JSON.stringify(value), "EX", STATE_TTL_SECONDS);
    },
    async del(key) {
      await redis.del(STATE_KEY_PREFIX + key);
    },
  };
}

/**
 * NodeOAuthClient's "sessionStore": the durable DPoP-bound token material
 * for a DID's AT OAuth grant. Postgres-backed (not Redis) because this
 * represents an actual authorization grant we may need to act on later
 * (e.g. background jobs writing to the user's repo), not ephemeral state —
 * see AtprotoOAuthSession in packages/database/prisma/schema.prisma.
 */
export function createPrismaSessionStore(prisma: PrismaClient): {
  get(did: string): Promise<NodeSavedSession | undefined>;
  set(did: string, value: NodeSavedSession): Promise<void>;
  del(did: string): Promise<void>;
} {
  return {
    async get(did) {
      const row = await prisma.atprotoOAuthSession.findUnique({ where: { did } });
      return row ? (row.sessionData as NodeSavedSession) : undefined;
    },
    async set(did, value) {
      await prisma.atprotoOAuthSession.upsert({
        where: { did },
        create: { did, sessionData: value as object },
        update: { sessionData: value as object },
      });
    },
    async del(did) {
      await prisma.atprotoOAuthSession.deleteMany({ where: { did } });
    },
  };
}
