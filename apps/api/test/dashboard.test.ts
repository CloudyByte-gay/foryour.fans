import { afterAll, describe, expect, it } from "vitest";
import {
  cleanupUser,
  createPostFor,
  createTierFor,
  loginAndBecomeCreator,
  loginNewUser,
  prisma,
  redis,
  subscribeAndActivate,
  uniqueHandle,
} from "./helpers.js";

afterAll(async () => {
  await prisma.$disconnect();
  redis.disconnect();
});

describe("GET /creators/me/dashboard", () => {
  it("requires authentication", async () => {
    const { app, did } = await loginNewUser(uniqueHandle("aaron"));
    const response = await app.inject({ method: "GET", url: "/creators/me/dashboard" });
    expect(response.statusCode).toBe(401);
    await app.close();
    await cleanupUser(did);
  });

  it("requires the caller to already be a creator", async () => {
    const { app, did, sessionId } = await loginNewUser(uniqueHandle("bella"));
    const response = await app.inject({
      method: "GET",
      url: "/creators/me/dashboard",
      cookies: { ff_session: sessionId },
    });
    expect(response.statusCode).toBe(404);
    await app.close();
    await cleanupUser(did);
  });

  it("defaults to a 30-day range and returns zeros for a brand-new creator", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("cody"));
    const response = await creator.app.inject({
      method: "GET",
      url: "/creators/me/dashboard",
      cookies: { ff_session: creator.sessionId },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({
      subscriberCount: 0,
      activeSubscriptions: 0,
      mrrCents: 0,
      revenueByTier: [],
      newSubscribers: 0,
      cancellations: 0,
      recentPosts: [],
      payout: null,
    });
    expect(body.timeSeries).toHaveLength(30);

    await creator.app.close();
    await cleanupUser(creator.did);
  });

  it("rejects an invalid date range", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("dana"));
    const response = await creator.app.inject({
      method: "GET",
      url: "/creators/me/dashboard?from=not-a-date&to=2026-01-01",
      cookies: { ff_session: creator.sessionId },
    });
    expect(response.statusCode).toBe(400);
    await creator.app.close();
    await cleanupUser(creator.did);
  });

  it("reflects a real subscriber's MRR/revenue-by-tier and never another creator's data", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("erin"));
    const otherCreator = await loginAndBecomeCreator(uniqueHandle("felix"));
    const tierId = await createTierFor(creator, { name: "Supporter", priceCents: 800, currency: "usd" });
    const otherTierId = await createTierFor(otherCreator, { name: "Other tier", priceCents: 5000, currency: "usd" });

    const subscriber = await loginNewUser(uniqueHandle("gwen"));
    await subscribeAndActivate(subscriber, creator, tierId);

    const otherSubscriber = await loginNewUser(uniqueHandle("hank"));
    await subscribeAndActivate(otherSubscriber, otherCreator, otherTierId);

    const response = await creator.app.inject({
      method: "GET",
      url: "/creators/me/dashboard",
      cookies: { ff_session: creator.sessionId },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.subscriberCount).toBe(1);
    expect(body.activeSubscriptions).toBe(1);
    expect(body.mrrCents).toBe(800);
    expect(body.newSubscribers).toBe(1);
    expect(body.revenueByTier).toEqual([
      { tierId, tierName: "Supporter", isActive: true, activeSubscribers: 1, monthlyRevenueCents: 800, currency: "usd" },
    ]);

    await creator.app.close();
    await otherCreator.app.close();
    await subscriber.app.close();
    await otherSubscriber.app.close();
    await cleanupUser(creator.did);
    await cleanupUser(otherCreator.did);
    await cleanupUser(subscriber.did);
    await cleanupUser(otherSubscriber.did);
  });

  it("includes the creator's own recent posts, newest first", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("iris"));
    await createPostFor(creator, { text: "first post" });
    await createPostFor(creator, { text: "second post" });

    const response = await creator.app.inject({
      method: "GET",
      url: "/creators/me/dashboard",
      cookies: { ff_session: creator.sessionId },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.recentPosts).toHaveLength(2);
    expect(body.recentPosts[0].text).toBe("second post");
    expect(body.recentPosts[1].text).toBe("first post");

    await creator.app.close();
    await cleanupUser(creator.did);
  });

  it("reports payout status null before onboarding and PENDING once started", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("jack"));

    const before = await creator.app.inject({
      method: "GET",
      url: "/creators/me/dashboard",
      cookies: { ff_session: creator.sessionId },
    });
    expect(before.json().payout).toBeNull();

    const creatorId = (await prisma.creator.findUniqueOrThrow({ where: { did: creator.did } })).id;
    await prisma.creator.update({ where: { id: creatorId }, data: { verificationStatus: "VERIFIED" } });

    await creator.app.inject({
      method: "POST",
      url: "/creators/me/payout-account",
      cookies: { ff_session: creator.sessionId },
      headers: { "x-csrf-token": creator.csrfToken },
    });

    const after = await creator.app.inject({
      method: "GET",
      url: "/creators/me/dashboard",
      cookies: { ff_session: creator.sessionId },
    });
    expect(after.json().payout).toMatchObject({ status: "PENDING", provider: "fake" });

    await creator.app.close();
    await cleanupUser(creator.did);
  });

  it("honors an explicit from/to range for newSubscribers", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("kate"));
    const tierId = await createTierFor(creator);
    const subscriber = await loginNewUser(uniqueHandle("liam"));
    await subscribeAndActivate(subscriber, creator, tierId);

    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const lastYear = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const twoYearsAgo = new Date(Date.now() - 500 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const inRange = await creator.app.inject({
      method: "GET",
      url: `/creators/me/dashboard?from=${yesterday}&to=${tomorrow}`,
      cookies: { ff_session: creator.sessionId },
    });
    expect(inRange.json().newSubscribers).toBe(1);

    const outOfRange = await creator.app.inject({
      method: "GET",
      url: `/creators/me/dashboard?from=${twoYearsAgo}&to=${lastYear}`,
      cookies: { ff_session: creator.sessionId },
    });
    expect(outOfRange.json().newSubscribers).toBe(0);
    // Snapshot fields are never range-dependent.
    expect(outOfRange.json().subscriberCount).toBe(1);

    await creator.app.close();
    await subscriber.app.close();
    await cleanupUser(creator.did);
    await cleanupUser(subscriber.did);
  });
});
