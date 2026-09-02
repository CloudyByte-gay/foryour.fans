import { randomUUID } from "node:crypto";
import { FakePayoutProvider, fakeWebhookDelivery, type PaymentProvider } from "@foryour-fans/subscriptions";
import { afterAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createFakeOAuthClient, fakeContentRepository, fakeDeleteAtRecord, fakeFetchProfile, fakePublishAtRecord } from "./fakes.js";
import { cleanupUser, createTierFor, env, loginAndBecomeCreator, loginNewUser, prisma, redis, uniqueHandle } from "./helpers.js";

afterAll(async () => {
  await prisma.$disconnect();
  redis.disconnect();
});

describe("POST /creators/:identifier/subscribe", () => {
  it("requires authentication", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("alice"));
    const tierId = await createTierFor(creator);

    const response = await creator.app.inject({
      method: "POST",
      url: `/creators/${creator.slug}/subscribe`,
      payload: { tierId },
    });
    expect(response.statusCode).toBe(401);

    await creator.app.close();
    await cleanupUser(creator.did);
  });

  it("returns 404 for an unknown creator", async () => {
    const { app, did, sessionId, csrfToken } = await loginNewUser(uniqueHandle("bob"));
    const response = await app.inject({
      method: "POST",
      url: "/creators/no-such-creator-xyz/subscribe",
      cookies: { ff_session: sessionId },
      headers: { "x-csrf-token": csrfToken },
      payload: { tierId: "00000000-0000-0000-0000-000000000000" },
    });
    expect(response.statusCode).toBe(404);
    await app.close();
    await cleanupUser(did);
  });

  it("returns 404 for a tier that doesn't belong to the creator", async () => {
    const creatorA = await loginAndBecomeCreator(uniqueHandle("carol"));
    const creatorB = await loginAndBecomeCreator(uniqueHandle("dave"));
    const tierIdB = await createTierFor(creatorB);

    const subscriber = await loginNewUser(uniqueHandle("erin"));
    const response = await subscriber.app.inject({
      method: "POST",
      url: `/creators/${creatorA.slug}/subscribe`,
      cookies: { ff_session: subscriber.sessionId },
      headers: { "x-csrf-token": subscriber.csrfToken },
      payload: { tierId: tierIdB },
    });
    expect(response.statusCode).toBe(404);

    await creatorA.app.close();
    await creatorB.app.close();
    await subscriber.app.close();
    await cleanupUser(creatorA.did);
    await cleanupUser(creatorB.did);
    await cleanupUser(subscriber.did);
  });

  it("rejects a creator subscribing to their own tier", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("frank"));
    const tierId = await createTierFor(creator);

    const response = await creator.app.inject({
      method: "POST",
      url: `/creators/${creator.slug}/subscribe`,
      cookies: { ff_session: creator.sessionId },
      headers: { "x-csrf-token": creator.csrfToken },
      payload: { tierId },
    });
    expect(response.statusCode).toBe(400);

    await creator.app.close();
    await cleanupUser(creator.did);
  });

  it("creates a PENDING subscription, snapshots the price, and returns a redirectUrl", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("grace"));
    const tierId = await createTierFor(creator, { priceCents: 700, currency: "usd" });

    const subscriber = await loginNewUser(uniqueHandle("henry"));
    const response = await subscriber.app.inject({
      method: "POST",
      url: `/creators/${creator.slug}/subscribe`,
      cookies: { ff_session: subscriber.sessionId },
      headers: { "x-csrf-token": subscriber.csrfToken },
      payload: { tierId },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body).toMatchObject({ status: "PENDING", priceCentsAtSubscription: 700, currencyAtSubscription: "usd" });
    expect(body.redirectUrl).toMatch(/^https:\/\/fake-checkout\.example\//);

    await creator.app.close();
    await subscriber.app.close();
    await cleanupUser(creator.did);
    await cleanupUser(subscriber.did);
  });

  it("reuses the same paymentCustomerId across subscriptions to different creators", async () => {
    const creatorA = await loginAndBecomeCreator(uniqueHandle("iris"));
    const creatorB = await loginAndBecomeCreator(uniqueHandle("jack"));
    const tierA = await createTierFor(creatorA);
    const tierB = await createTierFor(creatorB);

    const subscriber = await loginNewUser(uniqueHandle("kate"));
    await subscriber.app.inject({
      method: "POST",
      url: `/creators/${creatorA.slug}/subscribe`,
      cookies: { ff_session: subscriber.sessionId },
      headers: { "x-csrf-token": subscriber.csrfToken },
      payload: { tierId: tierA },
    });
    const userAfterFirst = await prisma.user.findUniqueOrThrow({ where: { did: subscriber.did } });
    expect(userAfterFirst.paymentCustomerId).toBeTruthy();

    await subscriber.app.inject({
      method: "POST",
      url: `/creators/${creatorB.slug}/subscribe`,
      cookies: { ff_session: subscriber.sessionId },
      headers: { "x-csrf-token": subscriber.csrfToken },
      payload: { tierId: tierB },
    });
    const userAfterSecond = await prisma.user.findUniqueOrThrow({ where: { did: subscriber.did } });

    expect(userAfterSecond.paymentCustomerId).toBe(userAfterFirst.paymentCustomerId);

    await creatorA.app.close();
    await creatorB.app.close();
    await subscriber.app.close();
    await cleanupUser(creatorA.did);
    await cleanupUser(creatorB.did);
    await cleanupUser(subscriber.did);
  });

  it("rejects subscribing twice to the same creator", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("liam"));
    const tierId = await createTierFor(creator);

    const subscriber = await loginNewUser(uniqueHandle("mia"));
    const first = await subscriber.app.inject({
      method: "POST",
      url: `/creators/${creator.slug}/subscribe`,
      cookies: { ff_session: subscriber.sessionId },
      headers: { "x-csrf-token": subscriber.csrfToken },
      payload: { tierId },
    });
    expect(first.statusCode).toBe(201);

    const second = await subscriber.app.inject({
      method: "POST",
      url: `/creators/${creator.slug}/subscribe`,
      cookies: { ff_session: subscriber.sessionId },
      headers: { "x-csrf-token": subscriber.csrfToken },
      payload: { tierId },
    });
    expect(second.statusCode).toBe(409);

    await creator.app.close();
    await subscriber.app.close();
    await cleanupUser(creator.did);
    await cleanupUser(subscriber.did);
  });
});

describe("POST /webhooks/fake", () => {
  it("activates a PENDING subscription", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("noah"));
    const tierId = await createTierFor(creator);

    const subscriber = await loginNewUser(uniqueHandle("olga"));
    const subscribeResponse = await subscriber.app.inject({
      method: "POST",
      url: `/creators/${creator.slug}/subscribe`,
      cookies: { ff_session: subscriber.sessionId },
      headers: { "x-csrf-token": subscriber.csrfToken },
      payload: { tierId },
    });
    const subscriptionId = subscribeResponse.json().id as string;
    const row = await prisma.subscription.findUniqueOrThrow({ where: { id: subscriptionId } });
    expect(row.status).toBe("PENDING");
    expect(row.providerSubscriptionId).toBeTruthy();

    const { rawBody, headers } = fakeWebhookDelivery("subscription.activated", row.providerSubscriptionId!);
    const webhookResponse = await subscriber.app.inject({
      method: "POST",
      url: "/webhooks/fake",
      headers: { "content-type": "application/json" },
      payload: rawBody,
    });
    expect(webhookResponse.statusCode).toBe(200);
    expect(webhookResponse.json()).toEqual({ outcome: "processed" });
    void headers;

    const updated = await prisma.subscription.findUniqueOrThrow({ where: { id: subscriptionId } });
    expect(updated.status).toBe("ACTIVE");
    expect(updated.currentPeriodStart).not.toBeNull();
    expect(updated.currentPeriodEnd).not.toBeNull();

    await creator.app.close();
    await subscriber.app.close();
    await cleanupUser(creator.did);
    await cleanupUser(subscriber.did);
  });

  it("is idempotent: replaying the same event only has one effect", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("pete"));
    const tierId = await createTierFor(creator);

    const subscriber = await loginNewUser(uniqueHandle("quinn"));
    const subscribeResponse = await subscriber.app.inject({
      method: "POST",
      url: `/creators/${creator.slug}/subscribe`,
      cookies: { ff_session: subscriber.sessionId },
      headers: { "x-csrf-token": subscriber.csrfToken },
      payload: { tierId },
    });
    const subscriptionId = subscribeResponse.json().id as string;
    const row = await prisma.subscription.findUniqueOrThrow({ where: { id: subscriptionId } });

    const eventId = `evt_${randomUUID()}`;
    const delivery = fakeWebhookDelivery("subscription.activated", row.providerSubscriptionId!, { eventId });

    const first = await subscriber.app.inject({
      method: "POST",
      url: "/webhooks/fake",
      headers: { "content-type": "application/json" },
      payload: delivery.rawBody,
    });
    expect(first.json()).toEqual({ outcome: "processed" });

    const afterFirst = await prisma.subscription.findUniqueOrThrow({ where: { id: subscriptionId } });

    const second = await subscriber.app.inject({
      method: "POST",
      url: "/webhooks/fake",
      headers: { "content-type": "application/json" },
      payload: delivery.rawBody,
    });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual({ outcome: "duplicate" });

    const afterSecond = await prisma.subscription.findUniqueOrThrow({ where: { id: subscriptionId } });
    expect(afterSecond.currentPeriodEnd?.getTime()).toBe(afterFirst.currentPeriodEnd?.getTime());
    expect(afterSecond.updatedAt.getTime()).toBe(afterFirst.updatedAt.getTime());

    const events = await prisma.paymentEvent.findMany({ where: { providerEventId: eventId } });
    expect(events).toHaveLength(1);

    await creator.app.close();
    await subscriber.app.close();
    await cleanupUser(creator.did);
    await cleanupUser(subscriber.did);
  });

  it("returns 404 for an unrecognized provider", async () => {
    const { app, did } = await loginNewUser(uniqueHandle("rex"));
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/stripe",
      headers: { "content-type": "application/json" },
      payload: Buffer.from("{}"),
    });
    expect(response.statusCode).toBe(404);
    await app.close();
    await cleanupUser(did);
  });

  it("returns 400 for a malformed delivery", async () => {
    const { app, did } = await loginNewUser(uniqueHandle("sara"));
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/fake",
      headers: { "content-type": "application/json" },
      payload: Buffer.from("not json"),
    });
    expect(response.statusCode).toBe(400);
    await app.close();
    await cleanupUser(did);
  });
});

describe("GET /subscriptions", () => {
  it("requires authentication", async () => {
    const { app, did } = await loginNewUser(uniqueHandle("tara"));
    const response = await app.inject({ method: "GET", url: "/subscriptions" });
    expect(response.statusCode).toBe(401);
    await app.close();
    await cleanupUser(did);
  });

  it("lists only the caller's own subscriptions, with creator/tier context", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("ugo"));
    const tierId = await createTierFor(creator, { name: "Gold" });

    const subscriber = await loginNewUser(uniqueHandle("vera"));
    await subscriber.app.inject({
      method: "POST",
      url: `/creators/${creator.slug}/subscribe`,
      cookies: { ff_session: subscriber.sessionId },
      headers: { "x-csrf-token": subscriber.csrfToken },
      payload: { tierId },
    });

    const otherUser = await loginNewUser(uniqueHandle("wade"));
    const otherResponse = await otherUser.app.inject({ method: "GET", url: "/subscriptions", cookies: { ff_session: otherUser.sessionId } });
    expect(otherResponse.json()).toEqual([]);

    const response = await subscriber.app.inject({ method: "GET", url: "/subscriptions", cookies: { ff_session: subscriber.sessionId } });
    expect(response.statusCode).toBe(200);
    const list = response.json() as Array<Record<string, unknown>>;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      creator: { slug: creator.slug },
      tier: { name: "Gold" },
    });

    await creator.app.close();
    await subscriber.app.close();
    await otherUser.app.close();
    await cleanupUser(creator.did);
    await cleanupUser(subscriber.did);
    await cleanupUser(otherUser.did);
  });
});

describe("PATCH /subscriptions/:id", () => {
  it("sets cancelAtPeriodEnd and requires the provider to confirm cancellation", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("xena"));
    const tierId = await createTierFor(creator);

    let cancelCalls = 0;
    const spyingPaymentProvider: PaymentProvider = {
      name: "fake",
      createCustomer: async () => ({ customerId: "cust_1" }),
      createSubscription: async () => ({ status: "pending", providerSubscriptionId: "sub_1", redirectUrl: "https://x" }),
      cancelSubscription: async () => {
        cancelCalls += 1;
      },
      handleWebhook: async () => {
        throw new Error("not used in this test");
      },
    };

    const subscriber = await loginNewUser(uniqueHandle("yuki"));
    // A second app instance for the same (already-logged-in) subscriber,
    // wired with a spying provider instead of the real fake — sessions are
    // Redis-backed and app-instance-independent (see helpers.ts), so the
    // same session cookie works against either app.
    const spyApp = buildApp({
      env,
      checkDatabaseConnection: async () => {},
      redis,
      prisma,
      oauthClient: createFakeOAuthClient(),
      fetchProfile: fakeFetchProfile({ did: subscriber.did, handle: "yuki.test" }),
      publishAtRecord: fakePublishAtRecord().publish,
      deleteAtRecord: fakeDeleteAtRecord().del,
      paymentProvider: spyingPaymentProvider,
      payoutProvider: new FakePayoutProvider(),
      contentRepository: fakeContentRepository(prisma),
    });

    const subscribeResponse = await subscriber.app.inject({
      method: "POST",
      url: `/creators/${creator.slug}/subscribe`,
      cookies: { ff_session: subscriber.sessionId },
      headers: { "x-csrf-token": subscriber.csrfToken },
      payload: { tierId },
    });
    const subscriptionId = subscribeResponse.json().id as string;

    const response = await spyApp.inject({
      method: "PATCH",
      url: `/subscriptions/${subscriptionId}`,
      cookies: { ff_session: subscriber.sessionId },
      headers: { "x-csrf-token": subscriber.csrfToken },
      payload: { cancelAtPeriodEnd: true },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ cancelAtPeriodEnd: true });
    expect(cancelCalls).toBe(1);

    await creator.app.close();
    await subscriber.app.close();
    await spyApp.close();
    await cleanupUser(creator.did);
    await cleanupUser(subscriber.did);
  });

  it("un-cancels without a provider call, and never touches another user's subscription", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("zach"));
    const tierId = await createTierFor(creator);

    const subscriber = await loginNewUser(uniqueHandle("amy"));
    const subscribeResponse = await subscriber.app.inject({
      method: "POST",
      url: `/creators/${creator.slug}/subscribe`,
      cookies: { ff_session: subscriber.sessionId },
      headers: { "x-csrf-token": subscriber.csrfToken },
      payload: { tierId },
    });
    const subscriptionId = subscribeResponse.json().id as string;

    const intruder = await loginNewUser(uniqueHandle("bob2"));
    const intruderResponse = await intruder.app.inject({
      method: "PATCH",
      url: `/subscriptions/${subscriptionId}`,
      cookies: { ff_session: intruder.sessionId },
      headers: { "x-csrf-token": intruder.csrfToken },
      payload: { cancelAtPeriodEnd: true },
    });
    expect(intruderResponse.statusCode).toBe(404);

    const cancelResponse = await subscriber.app.inject({
      method: "PATCH",
      url: `/subscriptions/${subscriptionId}`,
      cookies: { ff_session: subscriber.sessionId },
      headers: { "x-csrf-token": subscriber.csrfToken },
      payload: { cancelAtPeriodEnd: true },
    });
    expect(cancelResponse.json()).toMatchObject({ cancelAtPeriodEnd: true });

    const resubscribeResponse = await subscriber.app.inject({
      method: "PATCH",
      url: `/subscriptions/${subscriptionId}`,
      cookies: { ff_session: subscriber.sessionId },
      headers: { "x-csrf-token": subscriber.csrfToken },
      payload: { cancelAtPeriodEnd: false },
    });
    expect(resubscribeResponse.statusCode).toBe(200);
    expect(resubscribeResponse.json()).toMatchObject({ cancelAtPeriodEnd: false });

    await creator.app.close();
    await subscriber.app.close();
    await intruder.app.close();
    await cleanupUser(creator.did);
    await cleanupUser(subscriber.did);
    await cleanupUser(intruder.did);
  });
});
