import { randomUUID } from "node:crypto";
import { getPrismaClient, type Creator, type PrismaClient, type SubscriptionStatus } from "@foryour-fans/database";
import { afterAll, describe, expect, it } from "vitest";
import { DashboardRangeError, getCreatorDashboard, normalizeDashboardRange } from "./dashboard.js";

const prisma: PrismaClient = getPrismaClient();

function newDid(): string {
  return `did:plc:test${randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

interface Fixture {
  creator: Creator;
  tierAId: string;
  tierBId: string;
}

async function setup(): Promise<Fixture> {
  const creatorDid = newDid();
  const user = await prisma.user.create({ data: { did: creatorDid, handle: `${randomUUID().slice(0, 8)}.test` } });
  const creator = await prisma.creator.create({ data: { userId: user.id, did: creatorDid } });

  const tierA = await prisma.subscriptionTier.create({
    data: { creatorId: creator.id, name: "Supporter", priceCents: 1000, currency: "usd", sortOrder: 1, atRkey: randomUUID() },
  });
  const tierB = await prisma.subscriptionTier.create({
    data: { creatorId: creator.id, name: "VIP", priceCents: 2000, currency: "usd", sortOrder: 2, atRkey: randomUUID() },
  });

  return { creator, tierAId: tierA.id, tierBId: tierB.id };
}

async function addSubscriber(
  f: Fixture,
  opts: {
    tierId?: string;
    status?: SubscriptionStatus;
    priceCentsAtSubscription?: number;
    currency?: string;
    createdAt?: Date;
    updatedAt?: Date;
  } = {},
): Promise<string> {
  const user = await prisma.user.create({ data: { did: newDid(), handle: `${randomUUID().slice(0, 8)}.test` } });
  const sub = await prisma.subscription.create({
    data: {
      subscriberUserId: user.id,
      creatorId: f.creator.id,
      tierId: opts.tierId ?? f.tierAId,
      status: opts.status ?? "ACTIVE",
      provider: "fake",
      providerSubscriptionId: randomUUID(),
      priceCentsAtSubscription: opts.priceCentsAtSubscription ?? 1000,
      currencyAtSubscription: opts.currency ?? "usd",
      createdAt: opts.createdAt,
    },
  });
  if (opts.updatedAt) {
    await prisma.subscription.update({ where: { id: sub.id }, data: { updatedAt: opts.updatedAt } });
  }
  return sub.id;
}

async function cleanup(f: Fixture): Promise<void> {
  await prisma.subscription.deleteMany({ where: { creatorId: f.creator.id } });
  await prisma.subscriptionTier.deleteMany({ where: { creatorId: f.creator.id } });
  const creator = await prisma.creator.findUnique({ where: { id: f.creator.id } });
  await prisma.creator.deleteMany({ where: { id: f.creator.id } });
  if (creator) {
    await prisma.user.deleteMany({ where: { id: creator.userId } });
  }
}

afterAll(async () => {
  await prisma.$disconnect();
});

const DAY = 24 * 60 * 60 * 1000;

describe("normalizeDashboardRange", () => {
  it("normalizes start to 00:00:00.000 UTC and end to 23:59:59.999 UTC", () => {
    const range = normalizeDashboardRange(new Date("2026-08-05T14:30:00Z"), new Date("2026-08-10T02:00:00Z"));
    expect(range.start.toISOString()).toBe("2026-08-05T00:00:00.000Z");
    expect(range.end.toISOString()).toBe("2026-08-10T23:59:59.999Z");
  });

  it("rejects a range where start is after end", () => {
    expect(() => normalizeDashboardRange(new Date("2026-08-10Z"), new Date("2026-08-01Z"))).toThrow(DashboardRangeError);
  });

  it("rejects an invalid date", () => {
    expect(() => normalizeDashboardRange(new Date("not-a-date"), new Date())).toThrow(DashboardRangeError);
  });

  it("rejects a range longer than 366 days", () => {
    const start = new Date("2020-01-01T00:00:00Z");
    const end = new Date(start.getTime() + 400 * DAY);
    expect(() => normalizeDashboardRange(start, end)).toThrow(DashboardRangeError);
  });
});

describe("getCreatorDashboard", () => {
  it("distinguishes subscriberCount (PENDING/ACTIVE/PAST_DUE) from activeSubscriptions (ACTIVE only)", async () => {
    const f = await setup();
    try {
      await addSubscriber(f, { status: "ACTIVE" });
      await addSubscriber(f, { status: "PAST_DUE" });
      await addSubscriber(f, { status: "PENDING" });
      await addSubscriber(f, { status: "CANCELED" });

      const range = normalizeDashboardRange(new Date(Date.now() - 30 * DAY), new Date());
      const dashboard = await getCreatorDashboard(prisma, f.creator, range);

      expect(dashboard.subscriberCount).toBe(3);
      expect(dashboard.activeSubscriptions).toBe(1);
    } finally {
      await cleanup(f);
    }
  });

  it("computes mrrCents from the price snapshot, not the tier's current (possibly since-changed) price", async () => {
    const f = await setup();
    try {
      // Tier A's live price is 1000, but this subscriber locked in 700 before a price change.
      await addSubscriber(f, { status: "ACTIVE", priceCentsAtSubscription: 700 });
      await addSubscriber(f, { status: "ACTIVE", tierId: f.tierBId, priceCentsAtSubscription: 2000 });

      const range = normalizeDashboardRange(new Date(Date.now() - 30 * DAY), new Date());
      const dashboard = await getCreatorDashboard(prisma, f.creator, range);

      expect(dashboard.mrrCents).toBe(2700);
    } finally {
      await cleanup(f);
    }
  });

  it("groups revenueByTier by tier and omits a tier with zero active subscribers", async () => {
    const f = await setup();
    try {
      await addSubscriber(f, { status: "ACTIVE", tierId: f.tierAId, priceCentsAtSubscription: 1000 });
      await addSubscriber(f, { status: "ACTIVE", tierId: f.tierAId, priceCentsAtSubscription: 1000 });
      // tierB has a subscriber, but it's canceled — should not appear.
      await addSubscriber(f, { status: "CANCELED", tierId: f.tierBId, priceCentsAtSubscription: 2000 });

      const range = normalizeDashboardRange(new Date(Date.now() - 30 * DAY), new Date());
      const dashboard = await getCreatorDashboard(prisma, f.creator, range);

      expect(dashboard.revenueByTier).toEqual([
        { tierId: f.tierAId, tierName: "Supporter", isActive: true, activeSubscribers: 2, monthlyRevenueCents: 2000, currency: "usd" },
      ]);
    } finally {
      await cleanup(f);
    }
  });

  it("counts newSubscribers and cancellations only within the given range", async () => {
    const f = await setup();
    try {
      const now = Date.now();
      // Created 2 days ago — inside a 7-day range.
      await addSubscriber(f, { status: "ACTIVE", createdAt: new Date(now - 2 * DAY) });
      // Created 20 days ago — outside a 7-day range.
      await addSubscriber(f, { status: "ACTIVE", createdAt: new Date(now - 20 * DAY) });
      // Canceled 1 day ago — inside range.
      const canceledId = await addSubscriber(f, { status: "ACTIVE", createdAt: new Date(now - 25 * DAY) });
      await prisma.subscription.update({
        where: { id: canceledId },
        data: { status: "CANCELED", updatedAt: new Date(now - 1 * DAY) },
      });
      // Canceled 20 days ago — outside range.
      const oldCanceledId = await addSubscriber(f, { status: "ACTIVE", createdAt: new Date(now - 40 * DAY) });
      await prisma.subscription.update({
        where: { id: oldCanceledId },
        data: { status: "CANCELED", updatedAt: new Date(now - 20 * DAY) },
      });

      const range = normalizeDashboardRange(new Date(now - 6 * DAY), new Date(now));
      const dashboard = await getCreatorDashboard(prisma, f.creator, range);

      expect(dashboard.newSubscribers).toBe(1);
      expect(dashboard.cancellations).toBe(1);
    } finally {
      await cleanup(f);
    }
  });

  it("builds a daily time series reflecting subscriptions added and canceled on specific days", async () => {
    const f = await setup();
    try {
      const today = normalizeDashboardRange(new Date(), new Date()).start;
      const day0 = today.getTime() - 4 * DAY;

      // Active for the whole range.
      await addSubscriber(f, { status: "ACTIVE", createdAt: new Date(day0 - 10 * DAY), priceCentsAtSubscription: 500 });
      // Starts on day 2 of the range.
      await addSubscriber(f, { status: "ACTIVE", createdAt: new Date(day0 + 2 * DAY + 3600_000), priceCentsAtSubscription: 500 });
      // Ends (canceled) on day 3 of the range.
      const endsId = await addSubscriber(f, { status: "ACTIVE", createdAt: new Date(day0 - 5 * DAY), priceCentsAtSubscription: 500 });
      await prisma.subscription.update({
        where: { id: endsId },
        data: { status: "CANCELED", updatedAt: new Date(day0 + 3 * DAY + 3600_000) },
      });

      const range = normalizeDashboardRange(new Date(day0), new Date(day0 + 4 * DAY));
      const dashboard = await getCreatorDashboard(prisma, f.creator, range);

      expect(dashboard.timeSeries).toHaveLength(5);
      // Day 0: the always-active subscriber plus the one that ends later (created before the range).
      expect(dashboard.timeSeries[0]).toMatchObject({ activeSubscriptions: 2, mrrCents: 1000, newSubscribers: 0, cancellations: 0 });
      // Day 2: the new subscriber joins.
      expect(dashboard.timeSeries[2]).toMatchObject({ activeSubscriptions: 3, mrrCents: 1500, newSubscribers: 1, cancellations: 0 });
      // Day 3: one cancels (excluded starting the day its cancellation lands, per the module's "updatedAt as effective end" rule).
      expect(dashboard.timeSeries[3]).toMatchObject({ activeSubscriptions: 2, mrrCents: 1000, newSubscribers: 0, cancellations: 1 });
      // Day 4: still 2, the cancellation persists.
      expect(dashboard.timeSeries[4]).toMatchObject({ activeSubscriptions: 2, mrrCents: 1000 });
    } finally {
      await cleanup(f);
    }
  });

  it("returns an all-zero, usd-default dashboard for a creator with no subscriptions", async () => {
    const f = await setup();
    try {
      const range = normalizeDashboardRange(new Date(Date.now() - 6 * DAY), new Date());
      const dashboard = await getCreatorDashboard(prisma, f.creator, range);

      expect(dashboard.subscriberCount).toBe(0);
      expect(dashboard.activeSubscriptions).toBe(0);
      expect(dashboard.mrrCents).toBe(0);
      expect(dashboard.revenueByTier).toEqual([]);
      expect(dashboard.newSubscribers).toBe(0);
      expect(dashboard.cancellations).toBe(0);
      expect(dashboard.currency).toBe("usd");
      expect(dashboard.timeSeries.every((p) => p.activeSubscriptions === 0 && p.mrrCents === 0)).toBe(true);
    } finally {
      await cleanup(f);
    }
  });
});
