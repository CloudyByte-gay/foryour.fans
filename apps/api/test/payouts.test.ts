import { afterAll, describe, expect, it } from "vitest";
import { cleanupUser, loginAndBecomeCreator, loginNewUser, prisma, redis } from "./helpers.js";

afterAll(async () => {
  await prisma.$disconnect();
  redis.disconnect();
});

describe("POST /creators/me/payout-account", () => {
  it("requires authentication", async () => {
    const { app, did } = await loginNewUser("aaron2.test");
    const response = await app.inject({ method: "POST", url: "/creators/me/payout-account" });
    expect(response.statusCode).toBe(401);
    await app.close();
    await cleanupUser(did);
  });

  it("requires the caller to already be a creator", async () => {
    const { app, did, sessionId, csrfToken } = await loginNewUser("bella2.test");
    const response = await app.inject({
      method: "POST",
      url: "/creators/me/payout-account",
      cookies: { ff_session: sessionId },
      headers: { "x-csrf-token": csrfToken },
    });
    expect(response.statusCode).toBe(404);
    await app.close();
    await cleanupUser(did);
  });

  it("requires the caller to be a verified creator", async () => {
    const creator = await loginAndBecomeCreator("bree2.test");
    const response = await creator.app.inject({
      method: "POST",
      url: "/creators/me/payout-account",
      cookies: { ff_session: creator.sessionId },
      headers: { "x-csrf-token": creator.csrfToken },
    });
    expect(response.statusCode).toBe(403);

    const row = await prisma.payoutAccount.findFirst({
      where: { creatorId: (await prisma.creator.findUniqueOrThrow({ where: { did: creator.did } })).id },
    });
    expect(row).toBeNull();

    await creator.app.close();
    await cleanupUser(creator.did);
  });

  it("starts onboarding and returns an onboarding URL", async () => {
    const creator = await loginAndBecomeCreator("cody2.test");
    const creatorId = (await prisma.creator.findUniqueOrThrow({ where: { did: creator.did } })).id;
    await prisma.creator.update({ where: { id: creatorId }, data: { verificationStatus: "VERIFIED" } });

    const response = await creator.app.inject({
      method: "POST",
      url: "/creators/me/payout-account",
      cookies: { ff_session: creator.sessionId },
      headers: { "x-csrf-token": creator.csrfToken },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.status).toBe("PENDING");
    expect(body.onboardingUrl).toMatch(/^https:\/\/fake-payouts\.example\//);

    const row = await prisma.payoutAccount.findUniqueOrThrow({
      where: { creatorId: (await prisma.creator.findUniqueOrThrow({ where: { did: creator.did } })).id },
    });
    expect(row.status).toBe("PENDING");

    await creator.app.close();
    await cleanupUser(creator.did);
  });

  it("is idempotent: calling it twice doesn't create a second account", async () => {
    const creator = await loginAndBecomeCreator("dana2.test");
    const creatorId = (await prisma.creator.findUniqueOrThrow({ where: { did: creator.did } })).id;
    await prisma.creator.update({ where: { id: creatorId }, data: { verificationStatus: "VERIFIED" } });

    const first = await creator.app.inject({
      method: "POST",
      url: "/creators/me/payout-account",
      cookies: { ff_session: creator.sessionId },
      headers: { "x-csrf-token": creator.csrfToken },
    });
    const second = await creator.app.inject({
      method: "POST",
      url: "/creators/me/payout-account",
      cookies: { ff_session: creator.sessionId },
      headers: { "x-csrf-token": creator.csrfToken },
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    // The second call returns the existing account, so no onboardingUrl (nothing new to complete).
    expect(second.json().onboardingUrl).toBeUndefined();

    const rows = await prisma.payoutAccount.findMany({ where: { creatorId } });
    expect(rows).toHaveLength(1);

    await creator.app.close();
    await cleanupUser(creator.did);
  });
});

describe("GET /creators/me/payout-account/status", () => {
  it("requires authentication", async () => {
    const { app, did } = await loginNewUser("erin2.test");
    const response = await app.inject({ method: "GET", url: "/creators/me/payout-account/status" });
    expect(response.statusCode).toBe(401);
    await app.close();
    await cleanupUser(did);
  });

  it("returns 404 before onboarding has started", async () => {
    const creator = await loginAndBecomeCreator("finn2.test");
    const response = await creator.app.inject({
      method: "GET",
      url: "/creators/me/payout-account/status",
      cookies: { ff_session: creator.sessionId },
    });
    expect(response.statusCode).toBe(404);
    await creator.app.close();
    await cleanupUser(creator.did);
  });

  it("reflects the current status after onboarding started", async () => {
    const creator = await loginAndBecomeCreator("gwen2.test");
    const creatorId = (await prisma.creator.findUniqueOrThrow({ where: { did: creator.did } })).id;
    await prisma.creator.update({ where: { id: creatorId }, data: { verificationStatus: "VERIFIED" } });
    await creator.app.inject({
      method: "POST",
      url: "/creators/me/payout-account",
      cookies: { ff_session: creator.sessionId },
      headers: { "x-csrf-token": creator.csrfToken },
    });

    const response = await creator.app.inject({
      method: "GET",
      url: "/creators/me/payout-account/status",
      cookies: { ff_session: creator.sessionId },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: "PENDING" });

    await creator.app.close();
    await cleanupUser(creator.did);
  });
});
