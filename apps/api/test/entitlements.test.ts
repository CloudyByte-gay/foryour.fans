import { canAccess, fakeWebhookDelivery } from "@foryour-fans/subscriptions";
import { afterAll, describe, expect, it } from "vitest";
import { cleanupUser, createTierFor, loginAndBecomeCreator, loginNewUser, prisma, redis } from "./helpers.js";

afterAll(async () => {
  await prisma.$disconnect();
  redis.disconnect();
});

async function activateSubscription(subscriberApp: import("fastify").FastifyInstance, subscriptionId: string) {
  const row = await prisma.subscription.findUniqueOrThrow({ where: { id: subscriptionId } });
  const { rawBody } = fakeWebhookDelivery("subscription.activated", row.providerSubscriptionId!);
  await subscriberApp.inject({
    method: "POST",
    url: "/webhooks/fake",
    headers: { "content-type": "application/json" },
    payload: rawBody,
  });
}

describe("canAccess", () => {
  it("a creator always has access to their own content, without a subscription", async () => {
    const creator = await loginAndBecomeCreator("alice3.test");
    const result = await canAccess(prisma, { subscriberDid: creator.did, creatorDid: creator.did });
    expect(result).toBe(true);
    await creator.app.close();
    await cleanupUser(creator.did);
  });

  it("a DID with no subscription has no access", async () => {
    const creator = await loginAndBecomeCreator("bob3.test");
    const result = await canAccess(prisma, { subscriberDid: "did:plc:nobodyhome", creatorDid: creator.did });
    expect(result).toBe(false);
    await creator.app.close();
    await cleanupUser(creator.did);
  });

  it("a PENDING (unconfirmed) subscription grants no access", async () => {
    const creator = await loginAndBecomeCreator("carol3.test");
    const tierId = await createTierFor(creator);
    const subscriber = await loginNewUser("dave3.test");
    await subscriber.app.inject({
      method: "POST",
      url: `/creators/${creator.handle}/subscribe`,
      cookies: { ff_session: subscriber.sessionId },
      headers: { "x-csrf-token": subscriber.csrfToken },
      payload: { tierId },
    });

    const result = await canAccess(prisma, { subscriberDid: subscriber.did, creatorDid: creator.did });
    expect(result).toBe(false);

    await creator.app.close();
    await subscriber.app.close();
    await cleanupUser(creator.did);
    await cleanupUser(subscriber.did);
  });

  it("an ACTIVE subscription grants access with no requiredTierId", async () => {
    const creator = await loginAndBecomeCreator("erin3.test");
    const tierId = await createTierFor(creator);
    const subscriber = await loginNewUser("frank3.test");
    const subscribeResponse = await subscriber.app.inject({
      method: "POST",
      url: `/creators/${creator.handle}/subscribe`,
      cookies: { ff_session: subscriber.sessionId },
      headers: { "x-csrf-token": subscriber.csrfToken },
      payload: { tierId },
    });
    await activateSubscription(subscriber.app, subscribeResponse.json().id);

    const result = await canAccess(prisma, { subscriberDid: subscriber.did, creatorDid: creator.did });
    expect(result).toBe(true);

    await creator.app.close();
    await subscriber.app.close();
    await cleanupUser(creator.did);
    await cleanupUser(subscriber.did);
  });

  it("a PAST_DUE subscription grants no access", async () => {
    const creator = await loginAndBecomeCreator("gwen3.test");
    const tierId = await createTierFor(creator);
    const subscriber = await loginNewUser("henry3.test");
    const subscribeResponse = await subscriber.app.inject({
      method: "POST",
      url: `/creators/${creator.handle}/subscribe`,
      cookies: { ff_session: subscriber.sessionId },
      headers: { "x-csrf-token": subscriber.csrfToken },
      payload: { tierId },
    });
    const row = await prisma.subscription.findUniqueOrThrow({ where: { id: subscribeResponse.json().id } });
    const { rawBody } = fakeWebhookDelivery("subscription.past_due", row.providerSubscriptionId!);
    await subscriber.app.inject({
      method: "POST",
      url: "/webhooks/fake",
      headers: { "content-type": "application/json" },
      payload: rawBody,
    });

    const result = await canAccess(prisma, { subscriberDid: subscriber.did, creatorDid: creator.did });
    expect(result).toBe(false);

    await creator.app.close();
    await subscriber.app.close();
    await cleanupUser(creator.did);
    await cleanupUser(subscriber.did);
  });

  it("a higher-sortOrder tier grants access to a lower-sortOrder requirement, not vice versa", async () => {
    const creator = await loginAndBecomeCreator("iris3.test");
    const bronzeId = await createTierFor(creator, { name: "Bronze", priceCents: 300 });
    const goldId = await createTierFor(creator, { name: "Gold", priceCents: 1000 });
    // sortOrder defaults to 0 for both unless specified — set explicitly via PATCH so the hierarchy is unambiguous.
    await creator.app.inject({
      method: "PATCH",
      url: `/creators/me/tiers/${bronzeId}`,
      cookies: { ff_session: creator.sessionId },
      headers: { "x-csrf-token": creator.csrfToken },
      payload: { sortOrder: 1 },
    });
    await creator.app.inject({
      method: "PATCH",
      url: `/creators/me/tiers/${goldId}`,
      cookies: { ff_session: creator.sessionId },
      headers: { "x-csrf-token": creator.csrfToken },
      payload: { sortOrder: 2 },
    });

    const subscriber = await loginNewUser("jack3.test");
    const subscribeResponse = await subscriber.app.inject({
      method: "POST",
      url: `/creators/${creator.handle}/subscribe`,
      cookies: { ff_session: subscriber.sessionId },
      headers: { "x-csrf-token": subscriber.csrfToken },
      payload: { tierId: goldId },
    });
    await activateSubscription(subscriber.app, subscribeResponse.json().id);

    const accessToBronzeGate = await canAccess(prisma, {
      subscriberDid: subscriber.did,
      creatorDid: creator.did,
      requiredTierId: bronzeId,
    });
    expect(accessToBronzeGate).toBe(true); // Gold subscriber can see Bronze-gated content

    const accessToGoldGate = await canAccess(prisma, {
      subscriberDid: subscriber.did,
      creatorDid: creator.did,
      requiredTierId: goldId,
    });
    expect(accessToGoldGate).toBe(true); // exact match

    await creator.app.close();
    await subscriber.app.close();
    await cleanupUser(creator.did);
    await cleanupUser(subscriber.did);
  });

  it("a lower-sortOrder tier does NOT grant access to a higher-sortOrder requirement", async () => {
    const creator = await loginAndBecomeCreator("kate3.test");
    const bronzeId = await createTierFor(creator, { name: "Bronze", priceCents: 300 });
    const goldId = await createTierFor(creator, { name: "Gold", priceCents: 1000 });
    await creator.app.inject({
      method: "PATCH",
      url: `/creators/me/tiers/${bronzeId}`,
      cookies: { ff_session: creator.sessionId },
      headers: { "x-csrf-token": creator.csrfToken },
      payload: { sortOrder: 1 },
    });
    await creator.app.inject({
      method: "PATCH",
      url: `/creators/me/tiers/${goldId}`,
      cookies: { ff_session: creator.sessionId },
      headers: { "x-csrf-token": creator.csrfToken },
      payload: { sortOrder: 2 },
    });

    const subscriber = await loginNewUser("liam3.test");
    const subscribeResponse = await subscriber.app.inject({
      method: "POST",
      url: `/creators/${creator.handle}/subscribe`,
      cookies: { ff_session: subscriber.sessionId },
      headers: { "x-csrf-token": subscriber.csrfToken },
      payload: { tierId: bronzeId },
    });
    await activateSubscription(subscriber.app, subscribeResponse.json().id);

    const accessToGoldGate = await canAccess(prisma, {
      subscriberDid: subscriber.did,
      creatorDid: creator.did,
      requiredTierId: goldId,
    });
    expect(accessToGoldGate).toBe(false);

    await creator.app.close();
    await subscriber.app.close();
    await cleanupUser(creator.did);
    await cleanupUser(subscriber.did);
  });

  it("a suspended creator's content is inaccessible even to an active subscriber", async () => {
    const creator = await loginAndBecomeCreator("mona3.test");
    const tierId = await createTierFor(creator);
    const subscriber = await loginNewUser("noah3.test");
    const subscribeResponse = await subscriber.app.inject({
      method: "POST",
      url: `/creators/${creator.handle}/subscribe`,
      cookies: { ff_session: subscriber.sessionId },
      headers: { "x-csrf-token": subscriber.csrfToken },
      payload: { tierId },
    });
    await activateSubscription(subscriber.app, subscribeResponse.json().id);
    await prisma.creator.update({ where: { did: creator.did }, data: { status: "SUSPENDED" } });

    const result = await canAccess(prisma, { subscriberDid: subscriber.did, creatorDid: creator.did });
    expect(result).toBe(false);

    await creator.app.close();
    await subscriber.app.close();
    await cleanupUser(creator.did);
    await cleanupUser(subscriber.did);
  });
});
