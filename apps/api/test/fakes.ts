import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { randomBytes } from "node:crypto";
import type { AtprotoProfile, OAuthClientLike } from "@foryour-fans/atproto";
import { PrivateContentRepository, type ContentRepository } from "@foryour-fans/content";
import type { PrismaClient } from "@foryour-fans/database";
import { FakeObjectStorage, fixedResultMediaProcessor, type MediaProcessor, type ObjectStorage } from "@foryour-fans/media";
import type { OAuthSession } from "@atproto/oauth-client-node";
import type { Redis } from "ioredis";

/**
 * For tests (health/ready) that build a full app but never exercise a route
 * touching Redis/Postgres — avoids requiring live infra just to construct
 * the app object. `defineCommand` is the one method that must be present
 * even for these: @fastify/rate-limit's RedisStore calls it once, at plugin
 * registration (buildApp time), regardless of whether any rate-limited
 * route is ever actually hit — see app.ts. It's a synchronous Lua-script
 * registration with no return value used, so a no-op here is honest: it
 * satisfies that one boot-time call without giving this stub any real
 * Redis behavior, so health/ready's "never touches Redis at request time"
 * guarantee stays exactly as strict as before.
 */
export const dummyRedis = { defineCommand: () => {} } as unknown as Redis;
export const dummyPrisma = {} as unknown as PrismaClient;

/**
 * A fake satisfying OAuthClientLike so tests never hit a real PDS/AS. The
 * `session` value it hands back is opaque plumbing — only the paired fake
 * fetchProfile (below) gives it meaning, exactly like the real
 * NodeOAuthClient session is opaque to our routes except via Agent calls.
 */
export function createFakeOAuthClient(overrides: Partial<OAuthClientLike> = {}): OAuthClientLike {
  let state: string | null = null;
  return {
    clientMetadata: {},
    jwks: { keys: [] },
    authorize: async (_handle, options) => {
      state = options?.state ?? null;
      return new URL("https://pds.example/oauth/authorize?fake=1");
    },
    callback: async (params) => ({ session: {} as OAuthSession, state: params.get("appstate") ?? state }),
    restore: async (did) => ({ did }) as unknown as OAuthSession,
    ...overrides,
  };
}

export function fakeFetchProfile(profile: AtprotoProfile): (session: OAuthSession) => Promise<AtprotoProfile> {
  return async () => profile;
}

/** Records every call for assertions, and always "succeeds" with a fake uri/cid. */
export function fakePublishAtRecord(): {
  publish: (did: string, params: { collection: string; rkey: string; record: Record<string, unknown> }) => Promise<{ uri: string; cid: string }>;
  calls: Array<{ did: string; collection: string; rkey: string; record: Record<string, unknown> }>;
} {
  const calls: Array<{ did: string; collection: string; rkey: string; record: Record<string, unknown> }> = [];
  return {
    calls,
    publish: async (did, params) => {
      calls.push({ did, ...params });
      return { uri: `at://${did}/${params.collection}/${params.rkey}`, cid: "bafyfakecid" };
    },
  };
}

export function failingPublishAtRecord(message = "PDS unreachable"): (
  did: string,
  params: { collection: string; rkey: string; record: Record<string, unknown> },
) => Promise<{ uri: string; cid: string }> {
  return async () => {
    throw new Error(message);
  };
}

/** Records every call for assertions, and always "succeeds". */
export function fakeDeleteAtRecord(): {
  del: (did: string, params: { collection: string; rkey: string }) => Promise<void>;
  calls: Array<{ did: string; collection: string; rkey: string }>;
} {
  const calls: Array<{ did: string; collection: string; rkey: string }> = [];
  return {
    calls,
    del: async (did, params) => {
      calls.push({ did, ...params });
    },
  };
}

/**
 * A real PrivateContentRepository, not a hand-rolled fake — it's
 * Postgres-only (no external service to fake out, unlike
 * PaymentProvider/PayoutProvider), so tests that don't care about posts at
 * all (health/ready/auth/creators/tiers/subscriptions) can wire one up with
 * throwaway publish/delete fakes just to satisfy buildApp's required option.
 */
export function fakeContentRepository(prisma: PrismaClient): ContentRepository {
  return new PrivateContentRepository(prisma, fakePublishAtRecord().publish, fakeDeleteAtRecord().del);
}

export function failingDeleteAtRecord(message = "PDS unreachable"): (
  did: string,
  params: { collection: string; rkey: string },
) => Promise<void> {
  return async () => {
    throw new Error(message);
  };
}

/** Fresh FakeObjectStorage + an always-"ready" MediaProcessor — the default media deps for tests that don't care about media at all. */
export function fakeMediaDeps(): { objectStorage: ObjectStorage; mediaProcessor: MediaProcessor } {
  return { objectStorage: new FakeObjectStorage(), mediaProcessor: fixedResultMediaProcessor("ready") };
}

/** Exercise both halves of sign-in, retaining the browser-binding cookie. */
export async function completeFakeLogin(app: FastifyInstance, code = "fake"): Promise<LightMyRequestResponse> {
  // Separate synthetic browsers keep concurrent fixtures out of each other's
  // Redis rate-limit buckets. Dedicated rate-limit tests use a fixed socket IP.
  const remoteAddress = `2001:db8:${randomBytes(8).toString("hex").match(/.{4}/g)!.join(":")}::1`;
  const start = await app.inject({ method: "POST", url: "/auth/atproto/start", remoteAddress, payload: { handle: "alice.test" } });
  const state = start.cookies.find((cookie) => cookie.name === "ff_oauth_state")?.value;
  if (!state) throw new Error("Sign-in start did not set browser state");
  return app.inject({ method: "GET", url: `/auth/atproto/callback?code=${code}&state=fake`, cookies: { ff_oauth_state: state } });
}
