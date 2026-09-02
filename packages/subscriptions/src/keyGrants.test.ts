import { randomBytes, randomUUID } from "node:crypto";
import { getPrismaClient, type PrismaClient, type SubscriptionStatus } from "@foryour-fans/database";
import { afterAll, describe, expect, it } from "vitest";
import { ContentKeyNotFoundError, KeyGrantDeniedError, KeyGrantService } from "./keyGrants.js";

const prisma: PrismaClient = getPrismaClient();

/**
 * Wrap/unwrap doubles: the real envelope crypto lives in
 * @foryour-fans/media, but KeyGrantService only needs *an* unwrapper. A
 * base64 identity pair keeps this test independent of that package while
 * still proving the key round-trips byte-for-byte.
 */
const wrap = (key: Buffer): string => key.toString("base64");
const unwrap = (wrapped: string): Buffer => Buffer.from(wrapped, "base64");

const service = new KeyGrantService(prisma, unwrap);

function newDid(): string {
  return `did:plc:test${randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

interface Fixture {
  creatorDid: string;
  creatorId: string;
  subscriberDid: string;
  subscriberUserId: string;
  lowTierId: string;
  highTierId: string;
  contentKey: Buffer;
  subjectUri: string;
}

async function setup(opts: { audience: "SUBSCRIBERS" | "TIER"; requiredTier?: "low" | "high" } = { audience: "SUBSCRIBERS" }): Promise<Fixture> {
  const creatorDid = newDid();
  const subscriberDid = newDid();
  const creatorUser = await prisma.user.create({ data: { did: creatorDid, handle: `${randomUUID().slice(0, 8)}.test` } });
  const creator = await prisma.creator.create({ data: { userId: creatorUser.id, did: creatorDid } });
  const subscriberUser = await prisma.user.create({ data: { did: subscriberDid, handle: `${randomUUID().slice(0, 8)}.test` } });

  const lowTier = await prisma.subscriptionTier.create({
    data: { creatorId: creator.id, name: "Low", priceCents: 300, currency: "usd", sortOrder: 1, atRkey: randomUUID() },
  });
  const highTier = await prisma.subscriptionTier.create({
    data: { creatorId: creator.id, name: "High", priceCents: 900, currency: "usd", sortOrder: 2, atRkey: randomUUID() },
  });

  const contentKey = randomBytes(32);
  const subjectUri = `at://${creatorDid}/fans.foryour.post/${randomUUID().slice(0, 12)}`;
  await prisma.contentKey.create({
    data: {
      creatorId: creator.id,
      subjectUri,
      subjectType: "post",
      wrappedKey: wrap(contentKey),
      audience: opts.audience,
      requiredTierId: opts.audience === "TIER" ? (opts.requiredTier === "high" ? highTier.id : lowTier.id) : null,
    },
  });

  return {
    creatorDid,
    creatorId: creator.id,
    subscriberDid,
    subscriberUserId: subscriberUser.id,
    lowTierId: lowTier.id,
    highTierId: highTier.id,
    contentKey,
    subjectUri,
  };
}

async function giveSubscription(
  f: Fixture,
  status: SubscriptionStatus,
  opts: { tierId?: string; currentPeriodEnd?: Date | null } = {},
): Promise<string> {
  const sub = await prisma.subscription.create({
    data: {
      subscriberUserId: f.subscriberUserId,
      creatorId: f.creatorId,
      tierId: opts.tierId ?? f.lowTierId,
      status,
      provider: "fake",
      providerSubscriptionId: randomUUID(),
      priceCentsAtSubscription: 300,
      currencyAtSubscription: "usd",
      currentPeriodEnd: opts.currentPeriodEnd === undefined ? new Date(Date.now() + 30 * 86400_000) : opts.currentPeriodEnd,
    },
  });
  return sub.id;
}

async function cleanup(f: Fixture): Promise<void> {
  await prisma.contentKeyGrant.deleteMany({ where: { contentKey: { creatorId: f.creatorId } } });
  await prisma.contentKey.deleteMany({ where: { creatorId: f.creatorId } });
  await prisma.subscription.deleteMany({ where: { creatorId: f.creatorId } });
  await prisma.subscriptionTier.deleteMany({ where: { creatorId: f.creatorId } });
  await prisma.creator.deleteMany({ where: { id: f.creatorId } });
  await prisma.user.deleteMany({ where: { did: { in: [f.creatorDid, f.subscriberDid] } } });
}

afterAll(async () => {
  await prisma.$disconnect();
});

describe("KeyGrantService.requestContentKeyGrant", () => {
  it("hands the creator their own content key without any subscription", async () => {
    const f = await setup();
    const grant = await service.requestContentKeyGrant({ subscriberDid: f.creatorDid, subjectUri: f.subjectUri });
    expect(Buffer.from(grant.contentKeyBase64, "base64").equals(f.contentKey)).toBe(true);
    await cleanup(f);
  });

  it("grants a key to an ACTIVE, paid-current subscriber and records a ContentKeyGrant", async () => {
    const f = await setup();
    await giveSubscription(f, "ACTIVE");
    const grant = await service.requestContentKeyGrant({ subscriberDid: f.subscriberDid, subjectUri: f.subjectUri });

    expect(Buffer.from(grant.contentKeyBase64, "base64").equals(f.contentKey)).toBe(true);
    expect(grant.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(await service.hasUsableGrant(f.subscriberDid, f.subjectUri)).toBe(true);
    await cleanup(f);
  });

  it("denies when there is no subscription at all", async () => {
    const f = await setup();
    await expect(
      service.requestContentKeyGrant({ subscriberDid: f.subscriberDid, subjectUri: f.subjectUri }),
    ).rejects.toMatchObject({ reason: "no-subscription" });
    await cleanup(f);
  });

  it.each([
    ["PENDING", "subscription-not-active"],
    ["PAST_DUE", "subscription-past-due"],
    ["CANCELED", "subscription-canceled"],
    ["EXPIRED", "subscription-expired"],
  ] as const)("denies a %s subscription with reason %s", async (status, reason) => {
    const f = await setup();
    await giveSubscription(f, status);
    await expect(
      service.requestContentKeyGrant({ subscriberDid: f.subscriberDid, subjectUri: f.subjectUri }),
    ).rejects.toMatchObject({ reason });
    await cleanup(f);
  });

  it("denies an ACTIVE subscription whose paid period has lapsed", async () => {
    const f = await setup();
    await giveSubscription(f, "ACTIVE", { currentPeriodEnd: new Date(Date.now() - 86400_000) });
    await expect(
      service.requestContentKeyGrant({ subscriberDid: f.subscriberDid, subjectUri: f.subjectUri }),
    ).rejects.toMatchObject({ reason: "subscription-lapsed" });
    await cleanup(f);
  });

  it("denies a TIER post when the subscriber's tier is below the minimum", async () => {
    const f = await setup({ audience: "TIER", requiredTier: "high" });
    await giveSubscription(f, "ACTIVE", { tierId: f.lowTierId });
    await expect(
      service.requestContentKeyGrant({ subscriberDid: f.subscriberDid, subjectUri: f.subjectUri }),
    ).rejects.toMatchObject({ reason: "tier-too-low" });
    await cleanup(f);
  });

  it("grants a TIER post when the subscriber's tier meets the minimum", async () => {
    const f = await setup({ audience: "TIER", requiredTier: "low" });
    await giveSubscription(f, "ACTIVE", { tierId: f.highTierId });
    const grant = await service.requestContentKeyGrant({ subscriberDid: f.subscriberDid, subjectUri: f.subjectUri });
    expect(Buffer.from(grant.contentKeyBase64, "base64").equals(f.contentKey)).toBe(true);
    await cleanup(f);
  });

  it("throws ContentKeyNotFoundError for an unknown subject URI", async () => {
    const f = await setup();
    await expect(
      service.requestContentKeyGrant({ subscriberDid: f.subscriberDid, subjectUri: "at://did:plc:x/fans.foryour.post/nope" }),
    ).rejects.toBeInstanceOf(ContentKeyNotFoundError);
    await cleanup(f);
  });

  it("revokeGrantsForSubscription stops future usable grants for a lapsed subscription", async () => {
    const f = await setup();
    const subId = await giveSubscription(f, "ACTIVE");
    await service.requestContentKeyGrant({ subscriberDid: f.subscriberDid, subjectUri: f.subjectUri });
    expect(await service.hasUsableGrant(f.subscriberDid, f.subjectUri)).toBe(true);

    const revoked = await service.revokeGrantsForSubscription(subId);
    expect(revoked).toBe(1);
    expect(await service.hasUsableGrant(f.subscriberDid, f.subjectUri)).toBe(false);
    await cleanup(f);
  });

  it("rejects a request with no authenticated DID", async () => {
    await expect(
      service.requestContentKeyGrant({ subscriberDid: "", subjectUri: "at://did:plc:x/fans.foryour.post/y" }),
    ).rejects.toBeInstanceOf(KeyGrantDeniedError);
  });
});
