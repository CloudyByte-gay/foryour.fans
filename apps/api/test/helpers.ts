import { randomUUID } from "node:crypto";
import { PrivateContentRepository, type ContentRepository } from "@foryour-fans/content";
import { getPrismaClient, type PrismaClient } from "@foryour-fans/database";
import { FakeObjectStorage, fixedResultMediaProcessor, type MediaProcessor, type ObjectStorage } from "@foryour-fans/media";
import { getRedisClient } from "@foryour-fans/shared";
import { fakeWebhookDelivery, FakePaymentProvider, FakePayoutProvider, type KeyGrantService } from "@foryour-fans/subscriptions";
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

/** Deletes everything FK-linked to this DID, in dependency order, whether it's a subscriber's User, a Creator, or both (the same DID can be both). */
export async function cleanupUser(did: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { did } });
  const creator = await prisma.creator.findUnique({ where: { did } });

  const subscriptionFilters = [
    ...(user ? [{ subscriberUserId: user.id }] : []),
    ...(creator ? [{ creatorId: creator.id }] : []),
  ];
  // Content-key grants reference User with ON DELETE RESTRICT, and
  // ContentKey references Creator with ON DELETE CASCADE — clear grants
  // (for a subscriber) and keys (for a creator) before their rows go.
  const grantFilters = [
    ...(user ? [{ subscriberUserId: user.id }] : []),
    ...(creator ? [{ contentKey: { creatorId: creator.id } }] : []),
  ];
  if (grantFilters.length > 0) {
    await prisma.contentKeyGrant.deleteMany({ where: { OR: grantFilters } });
  }
  if (creator) {
    await prisma.contentKey.deleteMany({ where: { creatorId: creator.id } });
  }
  if (subscriptionFilters.length > 0) {
    await prisma.subscription.deleteMany({ where: { OR: subscriptionFilters } });
  }
  if (creator) {
    await prisma.payoutAccount.deleteMany({ where: { creatorId: creator.id } });
  }
  // posts before subscriptionTier: Post.minimumTierId -> SubscriptionTier is
  // ON DELETE SET NULL so order wouldn't strictly matter there, but
  // subscriptionTier -> creator has no cascade, so tiers must go before the
  // creator row regardless — see packages/content/src/repository.test.ts's
  // identical cleanup() for the same FK-ordering note. mediaAsset -> creator
  // has no cascade either, same reasoning — see packages/media/src/media.test.ts.
  // PostMedia joins Post<->MediaAsset with no cascade on either side, so it
  // must go before both (WEB PHASE 8).
  await prisma.postMedia.deleteMany({ where: { post: { creator: { did } } } });
  await prisma.post.deleteMany({ where: { creator: { did } } });
  await prisma.mediaAsset.deleteMany({ where: { creator: { did } } });
  await prisma.subscriptionTier.deleteMany({ where: { creator: { did } } });
  await prisma.creatorHandleHistory.deleteMany({ where: { did } });
  await prisma.creator.deleteMany({ where: { did } });
  await prisma.user.deleteMany({ where: { did } });
}

export interface TestSession {
  app: FastifyInstance;
  did: string;
  handle: string;
  sessionId: string;
  csrfToken: string;
  publishCalls: Array<{ did: string; collection: string; rkey: string; record: Record<string, unknown> }>;
  deleteCalls: Array<{ did: string; collection: string; rkey: string }>;
  objectStorage: ObjectStorage;
}

/** Logs a fresh user in (via the real callback flow) and returns everything needed to call authenticated routes. */
export interface LoginOverrides {
  publish?: ReturnType<typeof fakePublishAtRecord>;
  del?: ReturnType<typeof fakeDeleteAtRecord>;
  objectStorage?: ObjectStorage;
  mediaProcessor?: MediaProcessor;
  displayName?: string;
  avatarUrl?: string;
  bannerUrl?: string;
  /** Creator-owned-PDS tests: swap in CreatorOwnedContentRepository instead of the default PrivateContentRepository. */
  contentRepository?: ContentRepository;
  /** Creator-owned-PDS tests: enables POST /content-keys/grant. */
  keyGrantService?: KeyGrantService;
}

export async function loginNewUser(handle: string, overrides: LoginOverrides = {}): Promise<TestSession> {
  const did = newDid();
  const publish = overrides.publish ?? fakePublishAtRecord();
  const del = overrides.del ?? fakeDeleteAtRecord();
  const objectStorage = overrides.objectStorage ?? new FakeObjectStorage();
  const mediaProcessor = overrides.mediaProcessor ?? fixedResultMediaProcessor("ready");

  const app = buildApp({
    env,
    checkDatabaseConnection: async () => {},
    redis,
    prisma,
    oauthClient: createFakeOAuthClient(),
    fetchProfile: fakeFetchProfile({
      did,
      handle,
      displayName: overrides.displayName,
      avatarUrl: overrides.avatarUrl,
      bannerUrl: overrides.bannerUrl,
    }),
    publishAtRecord: publish.publish,
    deleteAtRecord: del.del,
    paymentProvider: new FakePaymentProvider(),
    payoutProvider: new FakePayoutProvider(),
    // Shares this session's publish/del fakes, so publishCalls/deleteCalls
    // below capture post AT writes too, not just creator/tier ones.
    contentRepository: overrides.contentRepository ?? new PrivateContentRepository(prisma, publish.publish, del.del),
    objectStorage,
    mediaProcessor,
    keyGrantService: overrides.keyGrantService,
  });

  const response = await app.inject({ method: "GET", url: "/auth/atproto/callback?code=fake&state=fake" });
  const sessionId = response.cookies.find((c) => c.name === "ff_session")?.value;
  const csrfToken = response.cookies.find((c) => c.name === "ff_csrf")?.value;
  if (!sessionId || !csrfToken) throw new Error("login did not set expected cookies");

  return { app, did, handle, sessionId, csrfToken, publishCalls: publish.calls, deleteCalls: del.calls, objectStorage };
}

/**
 * Logs a fresh user in AND creates a creator account for them. The public
 * creator identifier is the AT handle (`session.handle`) — there is no slug.
 */
export async function loginAndBecomeCreator(handle: string, overrides: LoginOverrides = {}): Promise<TestSession> {
  const session = await loginNewUser(handle, overrides);

  const response = await session.app.inject({
    method: "POST",
    url: "/creators",
    cookies: { ff_session: session.sessionId },
    headers: { "x-csrf-token": session.csrfToken },
    payload: {},
  });
  if (response.statusCode !== 201) {
    throw new Error(`loginAndBecomeCreator: POST /creators failed with ${response.statusCode}: ${response.body}`);
  }

  return session;
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

/** Creates a post for an already-logged-in creator session and returns its id. */
export async function createPostFor(
  creator: TestSession,
  fields: { visibility?: "PUBLIC" | "SUBSCRIBERS" | "TIER"; minimumTierId?: string; text?: string } = {},
): Promise<string> {
  const response = await creator.app.inject({
    method: "POST",
    url: "/creators/me/posts",
    cookies: { ff_session: creator.sessionId },
    headers: { "x-csrf-token": creator.csrfToken },
    payload: {
      visibility: fields.visibility ?? "PUBLIC",
      minimumTierId: fields.minimumTierId,
      text: fields.text ?? "hello world",
    },
  });
  if (response.statusCode !== 201) {
    throw new Error(`createPostFor: POST posts failed with ${response.statusCode}: ${response.body}`);
  }
  return (response.json() as { id: string }).id;
}

/** Creates a media asset for an already-logged-in creator session, completes its upload (READY by default), and returns its id. */
export async function createReadyMediaFor(
  creator: TestSession,
  fields: { mimeType?: string; size?: number } = {},
): Promise<string> {
  const uploadResponse = await creator.app.inject({
    method: "POST",
    url: "/media/upload-url",
    cookies: { ff_session: creator.sessionId },
    headers: { "x-csrf-token": creator.csrfToken },
    payload: { mimeType: fields.mimeType ?? "image/png", size: fields.size ?? 1024 },
  });
  if (uploadResponse.statusCode !== 201) {
    throw new Error(`createReadyMediaFor: POST /media/upload-url failed with ${uploadResponse.statusCode}: ${uploadResponse.body}`);
  }
  const { id } = uploadResponse.json() as { id: string };

  const completeResponse = await creator.app.inject({
    method: "POST",
    url: `/media/${id}/complete`,
    cookies: { ff_session: creator.sessionId },
    headers: { "x-csrf-token": creator.csrfToken },
  });
  if (completeResponse.statusCode !== 200) {
    throw new Error(`createReadyMediaFor: POST /media/:id/complete failed with ${completeResponse.statusCode}: ${completeResponse.body}`);
  }
  return id;
}

/**
 * Subscribes `subscriber` to `creator`'s tier and immediately activates it
 * via the fake webhook flow — the standard way tests get a real ACTIVE
 * subscription without hand-inserting rows. Extracted here once the same
 * few lines had been copy-pasted into posts.test.ts and media.test.ts.
 */
export async function subscribeAndActivate(
  subscriber: TestSession,
  creator: TestSession,
  tierId: string,
): Promise<void> {
  const response = await subscriber.app.inject({
    method: "POST",
    url: `/creators/${creator.handle}/subscribe`,
    cookies: { ff_session: subscriber.sessionId },
    headers: { "x-csrf-token": subscriber.csrfToken },
    payload: { tierId },
  });
  const { id: subscriptionId } = response.json() as { id: string };
  const row = await prisma.subscription.findUniqueOrThrow({ where: { id: subscriptionId } });
  const { rawBody } = fakeWebhookDelivery("subscription.activated", row.providerSubscriptionId!);
  await subscriber.app.inject({
    method: "POST",
    url: "/webhooks/fake",
    headers: { "content-type": "application/json" },
    payload: rawBody,
  });
}
