import { FakeObjectStorage, fixedResultMediaProcessor } from "@foryour-fans/media";
import { afterAll, describe, expect, it } from "vitest";
import {
  cleanupUser,
  createReadyMediaFor,
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

describe("POST /media/upload-url", () => {
  it("requires authentication", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("alice"));
    const response = await creator.app.inject({
      method: "POST",
      url: "/media/upload-url",
      payload: { mimeType: "image/png", size: 1024 },
    });
    expect(response.statusCode).toBe(401);
    await creator.app.close();
    await cleanupUser(creator.did);
  });

  it("requires the caller to already be a creator", async () => {
    const { app, did, sessionId, csrfToken } = await loginNewUser(uniqueHandle("bob"));
    const response = await app.inject({
      method: "POST",
      url: "/media/upload-url",
      cookies: { ff_session: sessionId },
      headers: { "x-csrf-token": csrfToken },
      payload: { mimeType: "image/png", size: 1024 },
    });
    expect(response.statusCode).toBe(404);
    await app.close();
    await cleanupUser(did);
  });

  it("creates a PENDING_UPLOAD asset and returns an uploadUrl", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("carol"));
    const response = await creator.app.inject({
      method: "POST",
      url: "/media/upload-url",
      cookies: { ff_session: creator.sessionId },
      headers: { "x-csrf-token": creator.csrfToken },
      payload: { mimeType: "image/png", size: 2048, width: 800, height: 600 },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json() as { status: string; uploadUrl: string; width: number; height: number };
    expect(body.status).toBe("PENDING_UPLOAD");
    expect(body.uploadUrl).toContain("fake-storage.test/upload/");
    expect(body.width).toBe(800);
    expect(body.height).toBe(600);

    await creator.app.close();
    await cleanupUser(creator.did);
  });

  it("rejects an unsupported mimeType", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("dave"));
    const response = await creator.app.inject({
      method: "POST",
      url: "/media/upload-url",
      cookies: { ff_session: creator.sessionId },
      headers: { "x-csrf-token": creator.csrfToken },
      payload: { mimeType: "application/pdf", size: 1024 },
    });
    expect(response.statusCode).toBe(400);
    await creator.app.close();
    await cleanupUser(creator.did);
  });

  it("rejects an oversized file", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("erin"));
    const response = await creator.app.inject({
      method: "POST",
      url: "/media/upload-url",
      cookies: { ff_session: creator.sessionId },
      headers: { "x-csrf-token": creator.csrfToken },
      payload: { mimeType: "image/png", size: 999_999_999 },
    });
    expect(response.statusCode).toBe(400);
    await creator.app.close();
    await cleanupUser(creator.did);
  });
});

describe("POST /media/:id/complete", () => {
  it("requires authentication", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("frank"));
    const response = await creator.app.inject({ method: "POST", url: "/media/00000000-0000-0000-0000-000000000000/complete" });
    expect(response.statusCode).toBe(401);
    await creator.app.close();
    await cleanupUser(creator.did);
  });

  it("transitions PENDING_UPLOAD to READY via the media processor", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("gwen"));
    const assetId = await createReadyMediaFor(creator);

    const asset = await prisma.mediaAsset.findUniqueOrThrow({ where: { id: assetId } });
    expect(asset.status).toBe("READY");

    await creator.app.close();
    await cleanupUser(creator.did);
  });

  it("transitions to REJECTED when the media processor rejects", async () => {
    const objectStorage = new FakeObjectStorage();
    const creator = await loginAndBecomeCreator(uniqueHandle("henry"), {
      objectStorage,
      mediaProcessor: fixedResultMediaProcessor("rejected"),
    });

    const uploadResponse = await creator.app.inject({
      method: "POST",
      url: "/media/upload-url",
      cookies: { ff_session: creator.sessionId },
      headers: { "x-csrf-token": creator.csrfToken },
      payload: { mimeType: "image/png", size: 1024 },
    });
    const { id } = uploadResponse.json() as { id: string };

    const completeResponse = await creator.app.inject({
      method: "POST",
      url: `/media/${id}/complete`,
      cookies: { ff_session: creator.sessionId },
      headers: { "x-csrf-token": creator.csrfToken },
    });
    expect(completeResponse.statusCode).toBe(200);
    expect(completeResponse.json()).toMatchObject({ status: "REJECTED" });

    await creator.app.close();
    await cleanupUser(creator.did);
  });

  it("returns 409 when called twice on the same asset", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("iris"));
    const assetId = await createReadyMediaFor(creator);

    const response = await creator.app.inject({
      method: "POST",
      url: `/media/${assetId}/complete`,
      cookies: { ff_session: creator.sessionId },
      headers: { "x-csrf-token": creator.csrfToken },
    });
    expect(response.statusCode).toBe(409);

    await creator.app.close();
    await cleanupUser(creator.did);
  });

  it("never lets one creator complete another creator's upload", async () => {
    const creatorA = await loginAndBecomeCreator(uniqueHandle("jack"));
    const creatorB = await loginAndBecomeCreator(uniqueHandle("kelly"));

    const uploadResponse = await creatorB.app.inject({
      method: "POST",
      url: "/media/upload-url",
      cookies: { ff_session: creatorB.sessionId },
      headers: { "x-csrf-token": creatorB.csrfToken },
      payload: { mimeType: "image/png", size: 1024 },
    });
    const { id } = uploadResponse.json() as { id: string };

    const response = await creatorA.app.inject({
      method: "POST",
      url: `/media/${id}/complete`,
      cookies: { ff_session: creatorA.sessionId },
      headers: { "x-csrf-token": creatorA.csrfToken },
    });
    expect(response.statusCode).toBe(404);

    await creatorA.app.close();
    await creatorB.app.close();
    await cleanupUser(creatorA.did);
    await cleanupUser(creatorB.did);
  });
});

describe("GET /media/:id/access — access control", () => {
  it("anonymous user cannot access a creator's media", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("liam"));
    const assetId = await createReadyMediaFor(creator);

    const response = await creator.app.inject({ method: "GET", url: `/media/${assetId}/access` });
    expect(response.statusCode).toBe(403);

    await creator.app.close();
    await cleanupUser(creator.did);
  });

  it("a logged-in non-subscriber cannot access the creator's media", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("mona"));
    const assetId = await createReadyMediaFor(creator);
    const stranger = await loginNewUser(uniqueHandle("noah"));

    const response = await stranger.app.inject({
      method: "GET",
      url: `/media/${assetId}/access`,
      cookies: { ff_session: stranger.sessionId },
    });
    expect(response.statusCode).toBe(403);

    await creator.app.close();
    await stranger.app.close();
    await cleanupUser(creator.did);
    await cleanupUser(stranger.did);
  });

  it("an ACTIVE subscriber (at any tier) can access the creator's media", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("owen"));
    const tierId = await createTierFor(creator);
    const assetId = await createReadyMediaFor(creator);
    const subscriber = await loginNewUser(uniqueHandle("penny"));
    await subscribeAndActivate(subscriber, creator, tierId);

    const response = await subscriber.app.inject({
      method: "GET",
      url: `/media/${assetId}/access`,
      cookies: { ff_session: subscriber.sessionId },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { url: string };
    expect(body.url).toContain("fake-storage.test/download/");

    await creator.app.close();
    await subscriber.app.close();
    await cleanupUser(creator.did);
    await cleanupUser(subscriber.did);
  });

  it("the creator can always access their own media, without a subscription", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("quinn"));
    const assetId = await createReadyMediaFor(creator);

    const response = await creator.app.inject({
      method: "GET",
      url: `/media/${assetId}/access`,
      cookies: { ff_session: creator.sessionId },
    });
    expect(response.statusCode).toBe(200);

    await creator.app.close();
    await cleanupUser(creator.did);
  });

  it("returns 404 for a PENDING_UPLOAD asset, even to its own creator", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("rosa"));
    const uploadResponse = await creator.app.inject({
      method: "POST",
      url: "/media/upload-url",
      cookies: { ff_session: creator.sessionId },
      headers: { "x-csrf-token": creator.csrfToken },
      payload: { mimeType: "image/png", size: 1024 },
    });
    const { id } = uploadResponse.json() as { id: string };

    const response = await creator.app.inject({
      method: "GET",
      url: `/media/${id}/access`,
      cookies: { ff_session: creator.sessionId },
    });
    expect(response.statusCode).toBe(404);

    await creator.app.close();
    await cleanupUser(creator.did);
  });

  it("returns 404 for a REJECTED asset, even to an entitled subscriber", async () => {
    const objectStorage = new FakeObjectStorage();
    const creator = await loginAndBecomeCreator(uniqueHandle("sam"), {
      objectStorage,
      mediaProcessor: fixedResultMediaProcessor("rejected"),
    });
    const tierId = await createTierFor(creator);

    const uploadResponse = await creator.app.inject({
      method: "POST",
      url: "/media/upload-url",
      cookies: { ff_session: creator.sessionId },
      headers: { "x-csrf-token": creator.csrfToken },
      payload: { mimeType: "image/png", size: 1024 },
    });
    const { id } = uploadResponse.json() as { id: string };
    await creator.app.inject({
      method: "POST",
      url: `/media/${id}/complete`,
      cookies: { ff_session: creator.sessionId },
      headers: { "x-csrf-token": creator.csrfToken },
    });

    const subscriber = await loginNewUser(uniqueHandle("tara"));
    await subscribeAndActivate(subscriber, creator, tierId);

    const response = await subscriber.app.inject({
      method: "GET",
      url: `/media/${id}/access`,
      cookies: { ff_session: subscriber.sessionId },
    });
    expect(response.statusCode).toBe(404);

    await creator.app.close();
    await subscriber.app.close();
    await cleanupUser(creator.did);
    await cleanupUser(subscriber.did);
  });

  it("returns 404 for a nonexistent asset", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("uma"));
    const response = await creator.app.inject({
      method: "GET",
      url: "/media/00000000-0000-0000-0000-000000000000/access",
    });
    expect(response.statusCode).toBe(404);
    await creator.app.close();
    await cleanupUser(creator.did);
  });
});
