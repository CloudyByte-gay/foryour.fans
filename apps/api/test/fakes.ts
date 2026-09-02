import type { AtprotoProfile, OAuthClientLike } from "@foryour-fans/atproto";
import { PrivateContentRepository, type ContentRepository } from "@foryour-fans/content";
import type { PrismaClient } from "@foryour-fans/database";
import { FakeObjectStorage, fixedResultMediaProcessor, type MediaProcessor, type ObjectStorage } from "@foryour-fans/media";
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
