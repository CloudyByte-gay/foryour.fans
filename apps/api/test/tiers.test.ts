import { FakePaymentProvider, FakePayoutProvider } from "@foryour-fans/subscriptions";
import { afterAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createFakeOAuthClient, fakeContentRepository, fakeDeleteAtRecord, fakeFetchProfile, fakeMediaDeps, failingPublishAtRecord } from "./fakes.js";
import { cleanupUser, env, loginAndBecomeCreator, loginNewUser, prisma, redis } from "./helpers.js";

afterAll(async () => {
  await prisma.$disconnect();
  redis.disconnect();
});

describe("POST /creators/me/tiers", () => {
  it("requires authentication", async () => {
    const { app, did } = await loginNewUser("aaron.test");
    const response = await app.inject({
      method: "POST",
      url: "/creators/me/tiers",
      payload: { name: "Supporter", priceCents: 500, currency: "usd" },
    });
    expect(response.statusCode).toBe(401);
    await app.close();
    await cleanupUser(did);
  });

  it("requires the caller to already be a creator", async () => {
    const { app, did, sessionId, csrfToken } = await loginNewUser("bella.test");
    const response = await app.inject({
      method: "POST",
      url: "/creators/me/tiers",
      cookies: { ff_session: sessionId },
      headers: { "x-csrf-token": csrfToken },
      payload: { name: "Supporter", priceCents: 500, currency: "usd" },
    });
    expect(response.statusCode).toBe(404);
    await app.close();
    await cleanupUser(did);
  });

  it("creates a tier, publishing a fans.foryour.tier AT record with a fresh rkey", async () => {
    const creator = await loginAndBecomeCreator("cody.test");
    creator.publishCalls.length = 0;

    const response = await creator.app.inject({
      method: "POST",
      url: "/creators/me/tiers",
      cookies: { ff_session: creator.sessionId },
      headers: { "x-csrf-token": creator.csrfToken },
      payload: { name: "Supporter", description: "thanks!", priceCents: 500, currency: "USD", sortOrder: 1 },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      name: "Supporter",
      description: "thanks!",
      priceCents: 500,
      currency: "usd",
      sortOrder: 1,
      isActive: true,
    });

    expect(creator.publishCalls).toHaveLength(1);
    expect(creator.publishCalls[0]).toMatchObject({
      did: creator.did,
      collection: "fans.foryour.tier",
      record: { name: "Supporter", monthlyPrice: 500, currency: "usd" },
    });
    expect(creator.publishCalls[0]?.rkey).toBeTruthy();

    await creator.app.close();
    await cleanupUser(creator.did);
  });

  it("supports multiple tiers per creator", async () => {
    const creator = await loginAndBecomeCreator("dana.test");

    const first = await creator.app.inject({
      method: "POST",
      url: "/creators/me/tiers",
      cookies: { ff_session: creator.sessionId },
      headers: { "x-csrf-token": creator.csrfToken },
      payload: { name: "Bronze", priceCents: 300, currency: "usd" },
    });
    const second = await creator.app.inject({
      method: "POST",
      url: "/creators/me/tiers",
      cookies: { ff_session: creator.sessionId },
      headers: { "x-csrf-token": creator.csrfToken },
      payload: { name: "Gold", priceCents: 1000, currency: "usd" },
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(first.json().id).not.toBe(second.json().id);

    const creatorRow = await prisma.creator.findUniqueOrThrow({ where: { did: creator.did } });
    const tiers = await prisma.subscriptionTier.findMany({ where: { creatorId: creatorRow.id } });
    expect(tiers).toHaveLength(2);

    await creator.app.close();
    await cleanupUser(creator.did);
  });

  it("rejects a zero or negative price", async () => {
    const creator = await loginAndBecomeCreator("erin.test");
    const response = await creator.app.inject({
      method: "POST",
      url: "/creators/me/tiers",
      cookies: { ff_session: creator.sessionId },
      headers: { "x-csrf-token": creator.csrfToken },
      payload: { name: "Free", priceCents: 0, currency: "usd" },
    });
    expect(response.statusCode).toBe(400);
    await creator.app.close();
    await cleanupUser(creator.did);
  });

  it("rejects an invalid currency code", async () => {
    const creator = await loginAndBecomeCreator("finn.test");
    const response = await creator.app.inject({
      method: "POST",
      url: "/creators/me/tiers",
      cookies: { ff_session: creator.sessionId },
      headers: { "x-csrf-token": creator.csrfToken },
      payload: { name: "Supporter", priceCents: 500, currency: "dollars" },
    });
    expect(response.statusCode).toBe(400);
    await creator.app.close();
    await cleanupUser(creator.did);
  });

  it("does not create a DB row if the AT record publish fails", async () => {
    // Sessions are Redis-backed and independent of which app instance
    // serves the request, so a second app wired with a failing publisher
    // can reuse the same session cookies a normal login produced.
    const creator = await loginAndBecomeCreator("gwen.test");
    const creatorRow = await prisma.creator.findUniqueOrThrow({ where: { did: creator.did } });

    const failingApp = buildApp({
      env,
      checkDatabaseConnection: async () => {},
      redis,
      prisma,
      oauthClient: createFakeOAuthClient(),
      fetchProfile: fakeFetchProfile({ did: creator.did, handle: "gwen.test" }),
      publishAtRecord: failingPublishAtRecord(),
      deleteAtRecord: fakeDeleteAtRecord().del,
      paymentProvider: new FakePaymentProvider(),
      payoutProvider: new FakePayoutProvider(),
      contentRepository: fakeContentRepository(prisma),
      ...fakeMediaDeps(),
    });

    const response = await failingApp.inject({
      method: "POST",
      url: "/creators/me/tiers",
      cookies: { ff_session: creator.sessionId },
      headers: { "x-csrf-token": creator.csrfToken },
      payload: { name: "WillFail", priceCents: 500, currency: "usd" },
    });
    expect(response.statusCode).toBe(502);

    const tiers = await prisma.subscriptionTier.findMany({ where: { creatorId: creatorRow.id } });
    expect(tiers).toHaveLength(0);

    await creator.app.close();
    await failingApp.close();
    await cleanupUser(creator.did);
  });
});

describe("PATCH /creators/me/tiers/:tierId", () => {
  it("republishes the AT record under the SAME rkey", async () => {
    const creator = await loginAndBecomeCreator("holly.test");
    const created = await creator.app.inject({
      method: "POST",
      url: "/creators/me/tiers",
      cookies: { ff_session: creator.sessionId },
      headers: { "x-csrf-token": creator.csrfToken },
      payload: { name: "Supporter", priceCents: 500, currency: "usd" },
    });
    const tierId = created.json().id as string;
    const originalRkey = creator.publishCalls[creator.publishCalls.length - 1]?.rkey;
    creator.publishCalls.length = 0;

    const response = await creator.app.inject({
      method: "PATCH",
      url: `/creators/me/tiers/${tierId}`,
      cookies: { ff_session: creator.sessionId },
      headers: { "x-csrf-token": creator.csrfToken },
      payload: { priceCents: 750 },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ name: "Supporter", priceCents: 750, currency: "usd" });

    expect(creator.publishCalls).toHaveLength(1);
    expect(creator.publishCalls[0]?.rkey).toBe(originalRkey);
    expect(creator.publishCalls[0]?.record).toMatchObject({ name: "Supporter", monthlyPrice: 750 });

    await creator.app.close();
    await cleanupUser(creator.did);
  });

  it("patches name + description + priceCents + currency together in one request", async () => {
    const creator = await loginAndBecomeCreator("holly2.test");
    const created = await creator.app.inject({
      method: "POST",
      url: "/creators/me/tiers",
      cookies: { ff_session: creator.sessionId },
      headers: { "x-csrf-token": creator.csrfToken },
      payload: { name: "Supporter", description: "thanks!", priceCents: 500, currency: "usd" },
    });
    const tierId = created.json().id as string;

    const response = await creator.app.inject({
      method: "PATCH",
      url: `/creators/me/tiers/${tierId}`,
      cookies: { ff_session: creator.sessionId },
      headers: { "x-csrf-token": creator.csrfToken },
      payload: {
        name: "Insider",
        description: "Everything in Supporter, plus a monthly members-only Q&A.",
        priceCents: 1200,
        currency: "usd",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ name: "Insider", priceCents: 1200 });

    await creator.app.close();
    await cleanupUser(creator.did);
  });

  it("is a no-op (no AT publish) when the patch body has no fields", async () => {
    const creator = await loginAndBecomeCreator("ivan.test");
    const created = await creator.app.inject({
      method: "POST",
      url: "/creators/me/tiers",
      cookies: { ff_session: creator.sessionId },
      headers: { "x-csrf-token": creator.csrfToken },
      payload: { name: "Supporter", priceCents: 500, currency: "usd" },
    });
    const tierId = created.json().id as string;
    creator.publishCalls.length = 0;

    const response = await creator.app.inject({
      method: "PATCH",
      url: `/creators/me/tiers/${tierId}`,
      cookies: { ff_session: creator.sessionId },
      headers: { "x-csrf-token": creator.csrfToken },
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    expect(creator.publishCalls).toHaveLength(0);

    await creator.app.close();
    await cleanupUser(creator.did);
  });

  it("never lets one creator patch another creator's tier", async () => {
    const a = await loginAndBecomeCreator("jill.test");
    const aTier = await a.app.inject({
      method: "POST",
      url: "/creators/me/tiers",
      cookies: { ff_session: a.sessionId },
      headers: { "x-csrf-token": a.csrfToken },
      payload: { name: "A's tier", priceCents: 500, currency: "usd" },
    });
    const aTierId = aTier.json().id as string;

    const b = await loginAndBecomeCreator("kyle.test");
    const response = await b.app.inject({
      method: "PATCH",
      url: `/creators/me/tiers/${aTierId}`,
      cookies: { ff_session: b.sessionId },
      headers: { "x-csrf-token": b.csrfToken },
      payload: { priceCents: 1 },
    });
    expect(response.statusCode).toBe(404);

    const stillA = await prisma.subscriptionTier.findUniqueOrThrow({ where: { id: aTierId } });
    expect(stillA.priceCents).toBe(500);

    await a.app.close();
    await b.app.close();
    await cleanupUser(a.did);
    await cleanupUser(b.did);
  });

  it("rejects an invalid price on update", async () => {
    const creator = await loginAndBecomeCreator("liam2.test");
    const created = await creator.app.inject({
      method: "POST",
      url: "/creators/me/tiers",
      cookies: { ff_session: creator.sessionId },
      headers: { "x-csrf-token": creator.csrfToken },
      payload: { name: "Supporter", priceCents: 500, currency: "usd" },
    });
    const tierId = created.json().id as string;

    const response = await creator.app.inject({
      method: "PATCH",
      url: `/creators/me/tiers/${tierId}`,
      cookies: { ff_session: creator.sessionId },
      headers: { "x-csrf-token": creator.csrfToken },
      payload: { priceCents: -5 },
    });
    expect(response.statusCode).toBe(400);

    await creator.app.close();
    await cleanupUser(creator.did);
  });
});

describe("DELETE /creators/me/tiers/:tierId", () => {
  it("deactivates the tier and deletes the AT record", async () => {
    const creator = await loginAndBecomeCreator("mona.test");
    const created = await creator.app.inject({
      method: "POST",
      url: "/creators/me/tiers",
      cookies: { ff_session: creator.sessionId },
      headers: { "x-csrf-token": creator.csrfToken },
      payload: { name: "Supporter", priceCents: 500, currency: "usd" },
    });
    const tierId = created.json().id as string;
    const rkey = creator.publishCalls[creator.publishCalls.length - 1]?.rkey;

    const response = await creator.app.inject({
      method: "DELETE",
      url: `/creators/me/tiers/${tierId}`,
      cookies: { ff_session: creator.sessionId },
      headers: { "x-csrf-token": creator.csrfToken },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ isActive: false });

    const row = await prisma.subscriptionTier.findUniqueOrThrow({ where: { id: tierId } });
    expect(row.isActive).toBe(false);

    expect(creator.deleteCalls).toHaveLength(1);
    expect(creator.deleteCalls[0]).toMatchObject({ did: creator.did, collection: "fans.foryour.tier", rkey });

    await creator.app.close();
    await cleanupUser(creator.did);
  });

  it("is idempotent: deleting twice only calls deleteAtRecord once", async () => {
    const creator = await loginAndBecomeCreator("nate.test");
    const created = await creator.app.inject({
      method: "POST",
      url: "/creators/me/tiers",
      cookies: { ff_session: creator.sessionId },
      headers: { "x-csrf-token": creator.csrfToken },
      payload: { name: "Supporter", priceCents: 500, currency: "usd" },
    });
    const tierId = created.json().id as string;

    const first = await creator.app.inject({
      method: "DELETE",
      url: `/creators/me/tiers/${tierId}`,
      cookies: { ff_session: creator.sessionId },
      headers: { "x-csrf-token": creator.csrfToken },
    });
    const second = await creator.app.inject({
      method: "DELETE",
      url: `/creators/me/tiers/${tierId}`,
      cookies: { ff_session: creator.sessionId },
      headers: { "x-csrf-token": creator.csrfToken },
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(creator.deleteCalls).toHaveLength(1);

    await creator.app.close();
    await cleanupUser(creator.did);
  });

  it("never lets one creator delete another creator's tier", async () => {
    const a = await loginAndBecomeCreator("olga.test");
    const aTier = await a.app.inject({
      method: "POST",
      url: "/creators/me/tiers",
      cookies: { ff_session: a.sessionId },
      headers: { "x-csrf-token": a.csrfToken },
      payload: { name: "A's tier", priceCents: 500, currency: "usd" },
    });
    const aTierId = aTier.json().id as string;

    const b = await loginAndBecomeCreator("pete.test");
    const response = await b.app.inject({
      method: "DELETE",
      url: `/creators/me/tiers/${aTierId}`,
      cookies: { ff_session: b.sessionId },
      headers: { "x-csrf-token": b.csrfToken },
    });
    expect(response.statusCode).toBe(404);

    const stillActive = await prisma.subscriptionTier.findUniqueOrThrow({ where: { id: aTierId } });
    expect(stillActive.isActive).toBe(true);

    await a.app.close();
    await b.app.close();
    await cleanupUser(a.did);
    await cleanupUser(b.did);
  });
});

describe("GET /creators/me/tiers", () => {
  it("requires authentication", async () => {
    const { app, did } = await loginNewUser("gina.test");
    const response = await app.inject({ method: "GET", url: "/creators/me/tiers" });
    expect(response.statusCode).toBe(401);
    await app.close();
    await cleanupUser(did);
  });

  it("returns 404 when the caller is not a creator", async () => {
    const { app, did, sessionId } = await loginNewUser("hank.test");
    const response = await app.inject({
      method: "GET",
      url: "/creators/me/tiers",
      cookies: { ff_session: sessionId },
    });
    expect(response.statusCode).toBe(404);
    await app.close();
    await cleanupUser(did);
  });

  it("lists the caller's tiers — active AND inactive — ordered by sortOrder, with isActive exposed", async () => {
    const creator = await loginAndBecomeCreator("ida.test");
    const post = (payload: Record<string, unknown>) =>
      creator.app.inject({
        method: "POST",
        url: "/creators/me/tiers",
        cookies: { ff_session: creator.sessionId },
        headers: { "x-csrf-token": creator.csrfToken },
        payload,
      });

    await post({ name: "Gold", priceCents: 1000, currency: "usd", sortOrder: 2 });
    await post({ name: "Bronze", priceCents: 300, currency: "usd", sortOrder: 1 });
    const retired = await post({ name: "Retired", priceCents: 100, currency: "usd", sortOrder: 0 });
    await creator.app.inject({
      method: "DELETE",
      url: `/creators/me/tiers/${retired.json().id}`,
      cookies: { ff_session: creator.sessionId },
      headers: { "x-csrf-token": creator.csrfToken },
    });

    const response = await creator.app.inject({
      method: "GET",
      url: "/creators/me/tiers",
      cookies: { ff_session: creator.sessionId },
    });
    expect(response.statusCode).toBe(200);

    const tiers = response.json() as Array<Record<string, unknown>>;
    expect(tiers.map((t) => t.name)).toEqual(["Retired", "Bronze", "Gold"]);
    expect(tiers.map((t) => t.isActive)).toEqual([false, true, true]);
    expect(tiers[0]).not.toHaveProperty("atRkey");
    expect(tiers[0]).not.toHaveProperty("creatorId");

    await creator.app.close();
    await cleanupUser(creator.did);
  });
});

describe("POST /creators/me/tiers/:tierId/reactivate", () => {
  it("re-publishes the AT record under the same rkey and flips isActive back on", async () => {
    const creator = await loginAndBecomeCreator("jena.test");
    const created = await creator.app.inject({
      method: "POST",
      url: "/creators/me/tiers",
      cookies: { ff_session: creator.sessionId },
      headers: { "x-csrf-token": creator.csrfToken },
      payload: { name: "Supporter", priceCents: 500, currency: "usd" },
    });
    const tierId = created.json().id as string;
    const rkey = creator.publishCalls[creator.publishCalls.length - 1]?.rkey;

    await creator.app.inject({
      method: "DELETE",
      url: `/creators/me/tiers/${tierId}`,
      cookies: { ff_session: creator.sessionId },
      headers: { "x-csrf-token": creator.csrfToken },
    });
    creator.publishCalls.length = 0;

    const response = await creator.app.inject({
      method: "POST",
      url: `/creators/me/tiers/${tierId}/reactivate`,
      cookies: { ff_session: creator.sessionId },
      headers: { "x-csrf-token": creator.csrfToken },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ id: tierId, name: "Supporter", isActive: true });
    expect(creator.publishCalls).toHaveLength(1);
    expect(creator.publishCalls[0]).toMatchObject({
      did: creator.did,
      collection: "fans.foryour.tier",
      rkey,
      record: { name: "Supporter", monthlyPrice: 500, currency: "usd" },
    });

    const row = await prisma.subscriptionTier.findUniqueOrThrow({ where: { id: tierId } });
    expect(row.isActive).toBe(true);

    await creator.app.close();
    await cleanupUser(creator.did);
  });

  it("is a no-op (no AT publish) when the tier is already active", async () => {
    const creator = await loginAndBecomeCreator("kara.test");
    const created = await creator.app.inject({
      method: "POST",
      url: "/creators/me/tiers",
      cookies: { ff_session: creator.sessionId },
      headers: { "x-csrf-token": creator.csrfToken },
      payload: { name: "Supporter", priceCents: 500, currency: "usd" },
    });
    const tierId = created.json().id as string;
    creator.publishCalls.length = 0;

    const response = await creator.app.inject({
      method: "POST",
      url: `/creators/me/tiers/${tierId}/reactivate`,
      cookies: { ff_session: creator.sessionId },
      headers: { "x-csrf-token": creator.csrfToken },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ isActive: true });
    expect(creator.publishCalls).toHaveLength(0);

    await creator.app.close();
    await cleanupUser(creator.did);
  });

  it("never lets one creator reactivate another creator's tier", async () => {
    const a = await loginAndBecomeCreator("lena.test");
    const aTier = await a.app.inject({
      method: "POST",
      url: "/creators/me/tiers",
      cookies: { ff_session: a.sessionId },
      headers: { "x-csrf-token": a.csrfToken },
      payload: { name: "A's tier", priceCents: 500, currency: "usd" },
    });
    const aTierId = aTier.json().id as string;
    await a.app.inject({
      method: "DELETE",
      url: `/creators/me/tiers/${aTierId}`,
      cookies: { ff_session: a.sessionId },
      headers: { "x-csrf-token": a.csrfToken },
    });

    const b = await loginAndBecomeCreator("marv.test");
    const response = await b.app.inject({
      method: "POST",
      url: `/creators/me/tiers/${aTierId}/reactivate`,
      cookies: { ff_session: b.sessionId },
      headers: { "x-csrf-token": b.csrfToken },
    });
    expect(response.statusCode).toBe(404);

    const stillInactive = await prisma.subscriptionTier.findUniqueOrThrow({ where: { id: aTierId } });
    expect(stillInactive.isActive).toBe(false);

    await a.app.close();
    await b.app.close();
    await cleanupUser(a.did);
    await cleanupUser(b.did);
  });
});

describe("GET /creators/:identifier/tiers", () => {
  it("lists only active tiers, sorted by sortOrder, and hides internal fields", async () => {
    const creator = await loginAndBecomeCreator("quinn.test");
    await creator.app.inject({
      method: "POST",
      url: "/creators/me/tiers",
      cookies: { ff_session: creator.sessionId },
      headers: { "x-csrf-token": creator.csrfToken },
      payload: { name: "Gold", priceCents: 1000, currency: "usd", sortOrder: 2 },
    });
    const bronze = await creator.app.inject({
      method: "POST",
      url: "/creators/me/tiers",
      cookies: { ff_session: creator.sessionId },
      headers: { "x-csrf-token": creator.csrfToken },
      payload: { name: "Bronze", priceCents: 300, currency: "usd", sortOrder: 1 },
    });
    const retired = await creator.app.inject({
      method: "POST",
      url: "/creators/me/tiers",
      cookies: { ff_session: creator.sessionId },
      headers: { "x-csrf-token": creator.csrfToken },
      payload: { name: "Retired", priceCents: 100, currency: "usd", sortOrder: 0 },
    });
    await creator.app.inject({
      method: "DELETE",
      url: `/creators/me/tiers/${retired.json().id}`,
      cookies: { ff_session: creator.sessionId },
      headers: { "x-csrf-token": creator.csrfToken },
    });

    const response = await creator.app.inject({ method: "GET", url: `/creators/${creator.handle}/tiers` });
    expect(response.statusCode).toBe(200);

    const tiers = response.json() as Array<Record<string, unknown>>;
    expect(tiers.map((t) => t.name)).toEqual(["Bronze", "Gold"]);
    expect(tiers[0]).not.toHaveProperty("isActive");
    expect(tiers[0]).not.toHaveProperty("atRkey");
    expect(tiers[0]).not.toHaveProperty("creatorId");

    void bronze;
    await creator.app.close();
    await cleanupUser(creator.did);
  });

  it("returns 404 for an unknown creator", async () => {
    const { app, did } = await loginNewUser("rosa.test");
    const response = await app.inject({ method: "GET", url: "/creators/no-such-creator-xyz/tiers" });
    expect(response.statusCode).toBe(404);
    await app.close();
    await cleanupUser(did);
  });
});
