import type { AtprotoProfile, OAuthClientLike } from "@foryour-fans/atproto";
import type { PrismaClient } from "@foryour-fans/database";
import type { OAuthSession } from "@atproto/oauth-client-node";
import type { Redis } from "ioredis";

/**
 * For tests (health/ready) that build a full app but never exercise a route
 * touching Redis/Postgres — avoids requiring live infra just to construct
 * the app object.
 */
export const dummyRedis = {} as unknown as Redis;
export const dummyPrisma = {} as unknown as PrismaClient;

/**
 * A fake satisfying OAuthClientLike so tests never hit a real PDS/AS. The
 * `session` value it hands back is opaque plumbing — only the paired fake
 * fetchProfile (below) gives it meaning, exactly like the real
 * NodeOAuthClient session is opaque to our routes except via Agent calls.
 */
export function createFakeOAuthClient(overrides: Partial<OAuthClientLike> = {}): OAuthClientLike {
  return {
    clientMetadata: {},
    jwks: { keys: [] },
    authorize: async (_handle, _options) => new URL("https://pds.example/oauth/authorize?fake=1"),
    callback: async (_params) => ({ session: {} as OAuthSession, state: null }),
    ...overrides,
  };
}

export function fakeFetchProfile(profile: AtprotoProfile): (session: OAuthSession) => Promise<AtprotoProfile> {
  return async () => profile;
}
