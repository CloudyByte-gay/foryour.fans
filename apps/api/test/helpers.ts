import { randomUUID } from "node:crypto";
import { getPrismaClient, type PrismaClient } from "@foryour-fans/database";
import { getRedisClient } from "@foryour-fans/shared";
import { FakePaymentProvider, FakePayoutProvider } from "@foryour-fans/subscriptions";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { createFakeOAuthClient, fakeDeleteAtRecord, fakeFetchProfile, fakePublishAtRecord } from "./fakes.js";
import { testEnv } from "./testEnv.js";

export const env = testEnv();
export const prisma: PrismaClient = getPrismaClient();
export const redis = getRedisClient(env.REDIS_URL);

export function newDid(): string {
  return `did:plc:test${randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

/**
 * A globally-unique fake AT handle. Prefer this over a hand-picked literal
 * like "alice.test" in new tests — vitest runs different test *files* in
 * parallel, and User.handle has no DB uniqueness constraint (it's a cache,
 * see prompts/full.md "Hosting model"), so two files independently picking
 * the same literal handle is a real, silent race condition, not just a
 * style nit — it bit `creators.test.ts` vs `subscriptions.test.ts` (both
 * used "liam.test") during Phase 6 development. `findActiveCreatorByIdentifier`'s
 * handle lookup has no deterministic tiebreak, so whichever row Postgres
 * happened to return first would make either test flake, nondeterministically.
 */
export function uniqueHandle(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8)}.test`;
}

export function uniqueSlug(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

/** Deletes everything FK-linked to this DID, in dependency order, whether it's a subscriber's User, a Creator, or both (the same DID can be both). */
export async function cleanupUser(did: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { did } });
  const creator = await prisma.creator.findUnique({ where: { did } });

  const subscriptionFilters = [
    ...(user ? [{ subscriberUserId: user.id }] : []),
    ...(creator ? [{ creatorId: creator.id }] : []),
  ];
  if (subscriptionFilters.length > 0) {
    await prisma.subscription.deleteMany({ where: { OR: subscriptionFilters } });
  }
  if (creator) {
    await prisma.payoutAccount.deleteMany({ where: { creatorId: creator.id } });
  }
  await prisma.subscriptionTier.deleteMany({ where: { creator: { did } } });
  await prisma.creator.deleteMany({ where: { did } });
  await prisma.user.deleteMany({ where: { did } });
}

export interface TestSession {
  app: FastifyInstance;
  did: string;
  sessionId: string;
  csrfToken: string;
  publishCalls: Array<{ did: string; collection: string; rkey: string; record: Record<string, unknown> }>;
  deleteCalls: Array<{ did: string; collection: string; rkey: string }>;
}

/** Logs a fresh user in (via the real callback flow) and returns everything needed to call authenticated routes. */
export async function loginNewUser(
  handle: string,
  overrides: { publish?: ReturnType<typeof fakePublishAtRecord>; del?: ReturnType<typeof fakeDeleteAtRecord> } = {},
): Promise<TestSession> {
  const did = newDid();
  const publish = overrides.publish ?? fakePublishAtRecord();
  const del = overrides.del ?? fakeDeleteAtRecord();

  const app = buildApp({
    env,
    checkDatabaseConnection: async () => {},
    redis,
    prisma,
    oauthClient: createFakeOAuthClient(),
    fetchProfile: fakeFetchProfile({ did, handle }),
    publishAtRecord: publish.publish,
    deleteAtRecord: del.del,
    paymentProvider: new FakePaymentProvider(),
    payoutProvider: new FakePayoutProvider(),
  });

  const response = await app.inject({ method: "GET", url: "/auth/atproto/callback?code=fake&state=fake" });
  const sessionId = response.cookies.find((c) => c.name === "ff_session")?.value;
  const csrfToken = response.cookies.find((c) => c.name === "ff_csrf")?.value;
  if (!sessionId || !csrfToken) throw new Error("login did not set expected cookies");

  return { app, did, sessionId, csrfToken, publishCalls: publish.calls, deleteCalls: del.calls };
}

/** Logs a fresh user in AND creates a creator account for them (slug auto-generated from the handle prefix). */
export async function loginAndBecomeCreator(
  handle: string,
  overrides: { publish?: ReturnType<typeof fakePublishAtRecord>; del?: ReturnType<typeof fakeDeleteAtRecord> } = {},
): Promise<TestSession & { slug: string }> {
  const session = await loginNewUser(handle, overrides);
  const slug = uniqueSlug(handle.split(".")[0] ?? "creator");

  const response = await session.app.inject({
    method: "POST",
    url: "/creators",
    cookies: { ff_session: session.sessionId },
    headers: { "x-csrf-token": session.csrfToken },
    payload: { slug },
  });
  if (response.statusCode !== 201) {
    throw new Error(`loginAndBecomeCreator: POST /creators failed with ${response.statusCode}: ${response.body}`);
  }

  return { ...session, slug };
}

/** Creates a tier for an already-logged-in creator session and returns its id. */
export async function createTierFor(
  creator: TestSession,
  fields: { name?: string; priceCents?: number; currency?: string } = {},
): Promise<string> {
  const response = await creator.app.inject({
    method: "POST",
    url: "/creators/me/tiers",
    cookies: { ff_session: creator.sessionId },
    headers: { "x-csrf-token": creator.csrfToken },
    payload: { name: fields.name ?? "Supporter", priceCents: fields.priceCents ?? 500, currency: fields.currency ?? "usd" },
  });
  if (response.statusCode !== 201) {
    throw new Error(`createTierFor: POST tiers failed with ${response.statusCode}: ${response.body}`);
  }
  return (response.json() as { id: string }).id;
}
