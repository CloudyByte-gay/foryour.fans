import { afterAll, describe, expect, it } from "vitest";
import { cleanupUser, loginAndBecomeCreator, loginNewUser, prisma, promoteToAdmin, redis, uniqueHandle } from "./helpers.js";

afterAll(async () => {
  await prisma.$disconnect();
  redis.disconnect();
});

describe("POST /creators/me/verification/submit", () => {
  it("requires being a creator", async () => {
    const { app, did, sessionId, csrfToken } = await loginNewUser(uniqueHandle("aaron"));
    const response = await app.inject({
      method: "POST",
      url: "/creators/me/verification/submit",
      cookies: { ff_session: sessionId },
      headers: { "x-csrf-token": csrfToken },
    });
    expect(response.statusCode).toBe(404);
    await app.close();
    await cleanupUser(did);
  });

  it("moves UNVERIFIED -> PENDING, then an admin can approve it", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("bella"));
    const admin = await loginNewUser(uniqueHandle("cara"));
    await promoteToAdmin(admin.did);

    const submitResponse = await creator.app.inject({
      method: "POST",
      url: "/creators/me/verification/submit",
      cookies: { ff_session: creator.sessionId },
      headers: { "x-csrf-token": creator.csrfToken },
    });
    expect(submitResponse.json()).toEqual({ verificationStatus: "PENDING" });

    const creatorRow = await prisma.creator.findUniqueOrThrow({ where: { did: creator.did } });
    const approveResponse = await admin.app.inject({
      method: "POST",
      url: `/admin/creators/${creatorRow.id}/verification/approve`,
      cookies: { ff_session: admin.sessionId },
      headers: { "x-csrf-token": admin.csrfToken },
    });
    expect(approveResponse.json()).toEqual({ verificationStatus: "VERIFIED" });

    await creator.app.close();
    await admin.app.close();
    await cleanupUser(creator.did);
    await cleanupUser(admin.did);
  });

  it("rejects a second submission while already PENDING", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("dax"));
    await creator.app.inject({
      method: "POST",
      url: "/creators/me/verification/submit",
      cookies: { ff_session: creator.sessionId },
      headers: { "x-csrf-token": creator.csrfToken },
    });

    const secondAttempt = await creator.app.inject({
      method: "POST",
      url: "/creators/me/verification/submit",
      cookies: { ff_session: creator.sessionId },
      headers: { "x-csrf-token": creator.csrfToken },
    });
    expect(secondAttempt.statusCode).toBe(409);

    await creator.app.close();
    await cleanupUser(creator.did);
  });

  it("gates marking a post as containing adult content on VERIFIED", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("eve"));

    const denied = await creator.app.inject({
      method: "POST",
      url: "/creators/me/posts",
      cookies: { ff_session: creator.sessionId },
      headers: { "x-csrf-token": creator.csrfToken },
      payload: { visibility: "PUBLIC", text: "spicy post", containsAdultContent: true },
    });
    expect(denied.statusCode).toBe(403);

    const admin = await loginNewUser(uniqueHandle("finn"));
    await promoteToAdmin(admin.did);
    const creatorRow = await prisma.creator.findUniqueOrThrow({ where: { did: creator.did } });
    await admin.app.inject({
      method: "POST",
      url: `/admin/creators/${creatorRow.id}/verification/approve`,
      cookies: { ff_session: admin.sessionId },
      headers: { "x-csrf-token": admin.csrfToken },
    });

    const allowed = await creator.app.inject({
      method: "POST",
      url: "/creators/me/posts",
      cookies: { ff_session: creator.sessionId },
      headers: { "x-csrf-token": creator.csrfToken },
      payload: { visibility: "PUBLIC", text: "spicy post", containsAdultContent: true },
    });
    expect(allowed.statusCode).toBe(201);
    expect(allowed.json()).toMatchObject({ containsAdultContent: true });

    await creator.app.close();
    await admin.app.close();
    await cleanupUser(creator.did);
    await cleanupUser(admin.did);
  });

  it("gates marking a tier as containing adult content on VERIFIED", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("gia"));

    const denied = await creator.app.inject({
      method: "POST",
      url: "/creators/me/tiers",
      cookies: { ff_session: creator.sessionId },
      headers: { "x-csrf-token": creator.csrfToken },
      payload: { name: "VIP", priceCents: 1000, currency: "usd", containsAdultContent: true },
    });
    expect(denied.statusCode).toBe(403);

    await creator.app.close();
    await cleanupUser(creator.did);
  });
});
