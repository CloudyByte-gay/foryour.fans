import { randomUUID } from "node:crypto";
import { getPrismaClient, type PrismaClient } from "@foryour-fans/database";
import { afterAll, describe, expect, it } from "vitest";
import { FakePaymentProvider, fakeWebhookDelivery, type FakeWebhookType } from "./providers/fakePaymentProvider.js";
import { processWebhookEvent, type WebhookOutcome } from "./webhooks.js";

const prisma: PrismaClient = getPrismaClient();
const paymentProvider = new FakePaymentProvider();

/** Builds and delivers a fake webhook in one call — avoids re-destructuring `{ rawBody, headers }` at every call site. */
function deliver(
  type: FakeWebhookType,
  providerSubscriptionId: string,
  options?: { eventId?: string; occurredAt?: Date },
): Promise<WebhookOutcome> {
  const { rawBody, headers } = fakeWebhookDelivery(type, providerSubscriptionId, options);
  return processWebhookEvent(prisma, paymentProvider, rawBody, headers);
}

afterAll(async () => {
  await prisma.$disconnect();
});

function newDid(): string {
  return `did:plc:test${randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

/** A bare subscription row — enough for webhooks.ts's own logic, no creator/tier needed. */
async function createSubscription(): Promise<{ id: string; providerSubscriptionId: string }> {
  const subscriberDid = newDid();
  const creatorDid = newDid();
  const subscriber = await prisma.user.create({ data: { did: subscriberDid, handle: `${randomUUID().slice(0, 8)}.test` } });
  const creatorUser = await prisma.user.create({ data: { did: creatorDid, handle: `${randomUUID().slice(0, 8)}.test` } });
  const creator = await prisma.creator.create({ data: { userId: creatorUser.id, did: creatorDid } });
  const tier = await prisma.subscriptionTier.create({
    data: { creatorId: creator.id, name: "Supporter", priceCents: 500, currency: "usd", atRkey: randomUUID() },
  });

  const providerSubscriptionId = `fake_sub_${randomUUID()}`;
  const subscription = await prisma.subscription.create({
    data: {
      subscriberUserId: subscriber.id,
      creatorId: creator.id,
      tierId: tier.id,
      status: "PENDING",
      provider: paymentProvider.name,
      providerSubscriptionId,
      priceCentsAtSubscription: tier.priceCents,
      currencyAtSubscription: tier.currency,
    },
  });

  return { id: subscription.id, providerSubscriptionId };
}

describe("processWebhookEvent — idempotency and replay", () => {
  it("processes a fresh event exactly once and reports a replay as a duplicate with no second effect", async () => {
    const { id, providerSubscriptionId } = await createSubscription();
    const eventId = `evt_${randomUUID()}`;

    expect(await deliver("subscription.activated", providerSubscriptionId, { eventId })).toBe("processed");
    const afterFirst = await prisma.subscription.findUniqueOrThrow({ where: { id } });
    expect(afterFirst.status).toBe("ACTIVE");

    expect(await deliver("subscription.activated", providerSubscriptionId, { eventId })).toBe("duplicate");
    const afterSecond = await prisma.subscription.findUniqueOrThrow({ where: { id } });
    expect(afterSecond.updatedAt).toEqual(afterFirst.updatedAt);
  });

  it("ignores an event for a providerSubscriptionId with no matching subscription", async () => {
    expect(await deliver("subscription.activated", `fake_sub_${randomUUID()}`)).toBe("ignored");
  });

  it("ignores an event type it doesn't recognize", async () => {
    const { providerSubscriptionId } = await createSubscription();
    const rawBody = Buffer.from(
      JSON.stringify({ id: `evt_${randomUUID()}`, type: "subscription.unknown_event", data: { providerSubscriptionId } }),
      "utf8",
    );
    const outcome = await processWebhookEvent(prisma, paymentProvider, rawBody, { "content-type": "application/json" });
    expect(outcome).toBe("ignored");
  });
});

describe("processWebhookEvent — out-of-order delivery", () => {
  it("applies events with timestamps in arrival order when they're already in order", async () => {
    const { id, providerSubscriptionId } = await createSubscription();
    const t1 = new Date("2026-01-01T00:00:00Z");
    const t2 = new Date("2026-01-01T00:05:00Z");

    expect(await deliver("subscription.activated", providerSubscriptionId, { occurredAt: t1 })).toBe("processed");
    expect((await prisma.subscription.findUniqueOrThrow({ where: { id } })).status).toBe("ACTIVE");

    expect(await deliver("subscription.past_due", providerSubscriptionId, { occurredAt: t2 })).toBe("processed");
    expect((await prisma.subscription.findUniqueOrThrow({ where: { id } })).status).toBe("PAST_DUE");
  });

  it("does NOT let a stale, later-arriving event undo a newer state", async () => {
    const { id, providerSubscriptionId } = await createSubscription();
    const earlier = new Date("2026-01-01T00:00:00Z");
    const later = new Date("2026-01-01T00:05:00Z");

    // The "activated" event actually happened LATER than the "past_due" one
    // below, but is delivered first — simulating the newer state landing
    // before an out-of-order redelivery of the older one.
    expect(await deliver("subscription.activated", providerSubscriptionId, { occurredAt: later })).toBe("processed");
    expect((await prisma.subscription.findUniqueOrThrow({ where: { id } })).status).toBe("ACTIVE");

    expect(await deliver("subscription.past_due", providerSubscriptionId, { occurredAt: earlier })).toBe("stale");
    expect((await prisma.subscription.findUniqueOrThrow({ where: { id } })).status).toBe("ACTIVE");
  });

  it("applies normally when neither event carries ordering info (backward-compatible default)", async () => {
    const { id, providerSubscriptionId } = await createSubscription();
    expect(await deliver("subscription.activated", providerSubscriptionId)).toBe("processed");
    expect(await deliver("subscription.past_due", providerSubscriptionId)).toBe("processed");
    expect((await prisma.subscription.findUniqueOrThrow({ where: { id } })).status).toBe("PAST_DUE");
  });
});

describe("processWebhookEvent — failed payments, cancellations, and refunds", () => {
  it("a failed payment moves an ACTIVE subscription to PAST_DUE, denying access without waiting for a grace period", async () => {
    const { id, providerSubscriptionId } = await createSubscription();
    await deliver("subscription.activated", providerSubscriptionId);

    expect(await deliver("payment.failed", providerSubscriptionId)).toBe("processed");
    expect((await prisma.subscription.findUniqueOrThrow({ where: { id } })).status).toBe("PAST_DUE");
  });

  it("a cancellation event moves an ACTIVE subscription to CANCELED", async () => {
    const { id, providerSubscriptionId } = await createSubscription();
    await deliver("subscription.activated", providerSubscriptionId);

    expect(await deliver("subscription.canceled", providerSubscriptionId)).toBe("processed");
    expect((await prisma.subscription.findUniqueOrThrow({ where: { id } })).status).toBe("CANCELED");
  });

  it("a refund revokes access immediately (CANCELED), not just at the end of the paid period", async () => {
    const { id, providerSubscriptionId } = await createSubscription();
    await deliver("subscription.activated", providerSubscriptionId);
    expect((await prisma.subscription.findUniqueOrThrow({ where: { id } })).currentPeriodEnd).not.toBeNull();

    expect(await deliver("payment.refunded", providerSubscriptionId)).toBe("processed");
    expect((await prisma.subscription.findUniqueOrThrow({ where: { id } })).status).toBe("CANCELED");
  });

  it("replaying the same refund event twice still only revokes access once (duplicate)", async () => {
    const { providerSubscriptionId } = await createSubscription();
    const eventId = `evt_${randomUUID()}`;

    expect(await deliver("payment.refunded", providerSubscriptionId, { eventId })).toBe("processed");
    expect(await deliver("payment.refunded", providerSubscriptionId, { eventId })).toBe("duplicate");
  });
});
