import { afterAll, describe, expect, it } from "vitest";
import {
  cleanupUser,
  createPostFor,
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

describe("POST /creators/me/posts", () => {
  it("requires authentication", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("alice"));
    const response = await creator.app.inject({
      method: "POST",
      url: "/creators/me/posts",
      payload: { visibility: "PUBLIC", text: "hello" },
    });
    expect(response.statusCode).toBe(401);
    await creator.app.close();
    await cleanupUser(creator.did);
  });

  it("requires the caller to already be a creator", async () => {
    const { app, did, sessionId, csrfToken } = await loginNewUser(uniqueHandle("bob"));
    const response = await app.inject({
      method: "POST",
      url: "/creators/me/posts",
      cookies: { ff_session: sessionId },
      headers: { "x-csrf-token": csrfToken },
      payload: { visibility: "PUBLIC", text: "hello" },
    });
    expect(response.statusCode).toBe(404);
    await app.close();
    await cleanupUser(did);
  });

  it("creates a PUBLIC post, publishing a fans.foryour.post AT record", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("carol"));
    const response = await creator.app.inject({
      method: "POST",
      url: "/creators/me/posts",
      cookies: { ff_session: creator.sessionId },
      headers: { "x-csrf-token": creator.csrfToken },
      payload: { visibility: "PUBLIC", text: "hello world" },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ visibility: "PUBLIC", text: "hello world" });

    const postPublish = creator.publishCalls.find((c) => c.collection === "fans.foryour.post");
    expect(postPublish).toMatchObject({ did: creator.did, record: { text: "hello world" } });

    await creator.app.close();
    await cleanupUser(creator.did);
  });

  it("creates a SUBSCRIBERS post without touching the AT network", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("dave"));
    const response = await creator.app.inject({
      method: "POST",
      url: "/creators/me/posts",
      cookies: { ff_session: creator.sessionId },
      headers: { "x-csrf-token": creator.csrfToken },
      payload: { visibility: "SUBSCRIBERS", text: "paid content" },
    });

    expect(response.statusCode).toBe(201);
    expect(creator.publishCalls.find((c) => c.collection === "fans.foryour.post")).toBeUndefined();

    await creator.app.close();
    await cleanupUser(creator.did);
  });

  it("creates a TIER post given an owned tier id", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("erin"));
    const tierId = await createTierFor(creator);
    const response = await creator.app.inject({
      method: "POST",
      url: "/creators/me/posts",
      cookies: { ff_session: creator.sessionId },
      headers: { "x-csrf-token": creator.csrfToken },
      payload: { visibility: "TIER", minimumTierId: tierId, text: "premium" },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ visibility: "TIER", minimumTierId: tierId });

    await creator.app.close();
    await cleanupUser(creator.did);
  });

  it("rejects TIER visibility with no minimumTierId", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("frank"));
    const response = await creator.app.inject({
      method: "POST",
      url: "/creators/me/posts",
      cookies: { ff_session: creator.sessionId },
      headers: { "x-csrf-token": creator.csrfToken },
      payload: { visibility: "TIER", text: "premium" },
    });
    expect(response.statusCode).toBe(400);
    await creator.app.close();
    await cleanupUser(creator.did);
  });

  it("rejects a minimumTierId belonging to a different creator", async () => {
    const creatorA = await loginAndBecomeCreator(uniqueHandle("gwen"));
    const creatorB = await loginAndBecomeCreator(uniqueHandle("henry"));
    const tierIdB = await createTierFor(creatorB);

    const response = await creatorA.app.inject({
      method: "POST",
      url: "/creators/me/posts",
      cookies: { ff_session: creatorA.sessionId },
      headers: { "x-csrf-token": creatorA.csrfToken },
      payload: { visibility: "TIER", minimumTierId: tierIdB, text: "premium" },
    });
    expect(response.statusCode).toBe(400);

    await creatorA.app.close();
    await creatorB.app.close();
    await cleanupUser(creatorA.did);
    await cleanupUser(creatorB.did);
  });

  it("rejects a minimumTierId on a non-TIER post", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("iris"));
    const tierId = await createTierFor(creator);
    const response = await creator.app.inject({
      method: "POST",
      url: "/creators/me/posts",
      cookies: { ff_session: creator.sessionId },
      headers: { "x-csrf-token": creator.csrfToken },
      payload: { visibility: "SUBSCRIBERS", minimumTierId: tierId, text: "premium" },
    });
    expect(response.statusCode).toBe(400);
    await creator.app.close();
    await cleanupUser(creator.did);
  });

  it("rejects empty text", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("jack"));
    const response = await creator.app.inject({
      method: "POST",
      url: "/creators/me/posts",
      cookies: { ff_session: creator.sessionId },
      headers: { "x-csrf-token": creator.csrfToken },
      payload: { visibility: "PUBLIC", text: "   " },
    });
    expect(response.statusCode).toBe(400);
    await creator.app.close();
    await cleanupUser(creator.did);
  });
});

describe("PATCH /creators/me/posts/:id", () => {
  it("requires authentication", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("pat"));
    const postId = await createPostFor(creator);
    const response = await creator.app.inject({
      method: "PATCH",
      url: `/creators/me/posts/${postId}`,
      payload: { visibility: "PUBLIC", text: "edited" },
    });
    expect(response.statusCode).toBe(401);
    await creator.app.close();
    await cleanupUser(creator.did);
  });

  it("edits a post's text", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("quill"));
    const postId = await createPostFor(creator, { visibility: "SUBSCRIBERS", text: "before" });

    const response = await creator.app.inject({
      method: "PATCH",
      url: `/creators/me/posts/${postId}`,
      cookies: { ff_session: creator.sessionId },
      headers: { "x-csrf-token": creator.csrfToken },
      payload: { visibility: "SUBSCRIBERS", text: "after" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ id: postId, visibility: "SUBSCRIBERS", text: "after" });
    await creator.app.close();
    await cleanupUser(creator.did);
  });

  it("publishes a fans.foryour.post AT record when a post becomes PUBLIC", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("rhea"));
    const postId = await createPostFor(creator, { visibility: "SUBSCRIBERS", text: "going public" });

    const response = await creator.app.inject({
      method: "PATCH",
      url: `/creators/me/posts/${postId}`,
      cookies: { ff_session: creator.sessionId },
      headers: { "x-csrf-token": creator.csrfToken },
      payload: { visibility: "PUBLIC", text: "going public" },
    });
    expect(response.statusCode).toBe(200);
    expect(creator.publishCalls.some((c) => c.collection === "fans.foryour.post")).toBe(true);
    await creator.app.close();
    await cleanupUser(creator.did);
  });

  it("retracts the AT record when a PUBLIC post moves to SUBSCRIBERS", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("silas"));
    const postId = await createPostFor(creator, { visibility: "PUBLIC", text: "was public" });

    const response = await creator.app.inject({
      method: "PATCH",
      url: `/creators/me/posts/${postId}`,
      cookies: { ff_session: creator.sessionId },
      headers: { "x-csrf-token": creator.csrfToken },
      payload: { visibility: "SUBSCRIBERS", text: "was public" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ visibility: "SUBSCRIBERS" });
    expect(creator.deleteCalls.some((c) => c.collection === "fans.foryour.post")).toBe(true);
    await creator.app.close();
    await cleanupUser(creator.did);
  });

  it("moves a post to a TIER given an owned tier id, and clears the gate when moving off TIER", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("tara"));
    const tierId = await createTierFor(creator);
    const postId = await createPostFor(creator, { visibility: "SUBSCRIBERS", text: "gate me" });

    const toTier = await creator.app.inject({
      method: "PATCH",
      url: `/creators/me/posts/${postId}`,
      cookies: { ff_session: creator.sessionId },
      headers: { "x-csrf-token": creator.csrfToken },
      payload: { visibility: "TIER", minimumTierId: tierId, text: "gate me" },
    });
    expect(toTier.statusCode).toBe(200);
    expect(toTier.json()).toMatchObject({ visibility: "TIER", minimumTierId: tierId });

    const offTier = await creator.app.inject({
      method: "PATCH",
      url: `/creators/me/posts/${postId}`,
      cookies: { ff_session: creator.sessionId },
      headers: { "x-csrf-token": creator.csrfToken },
      payload: { visibility: "SUBSCRIBERS", text: "gate me" },
    });
    expect(offTier.statusCode).toBe(200);
    expect(offTier.json()).toMatchObject({ visibility: "SUBSCRIBERS", minimumTierId: null });

    await creator.app.close();
    await cleanupUser(creator.did);
  });

  it("rejects TIER visibility with no minimumTierId", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("uri"));
    const postId = await createPostFor(creator, { visibility: "SUBSCRIBERS" });
    const response = await creator.app.inject({
      method: "PATCH",
      url: `/creators/me/posts/${postId}`,
      cookies: { ff_session: creator.sessionId },
      headers: { "x-csrf-token": creator.csrfToken },
      payload: { visibility: "TIER", text: "no tier" },
    });
    expect(response.statusCode).toBe(400);
    await creator.app.close();
    await cleanupUser(creator.did);
  });

  it("rejects a minimumTierId belonging to a different creator", async () => {
    const creatorA = await loginAndBecomeCreator(uniqueHandle("vale"));
    const creatorB = await loginAndBecomeCreator(uniqueHandle("wes"));
    const tierIdB = await createTierFor(creatorB);
    const postId = await createPostFor(creatorA, { visibility: "SUBSCRIBERS" });

    const response = await creatorA.app.inject({
      method: "PATCH",
      url: `/creators/me/posts/${postId}`,
      cookies: { ff_session: creatorA.sessionId },
      headers: { "x-csrf-token": creatorA.csrfToken },
      payload: { visibility: "TIER", minimumTierId: tierIdB, text: "borrowed tier" },
    });
    expect(response.statusCode).toBe(400);

    await creatorA.app.close();
    await creatorB.app.close();
    await cleanupUser(creatorA.did);
    await cleanupUser(creatorB.did);
  });

  it("never lets one creator edit another creator's post", async () => {
    const creatorA = await loginAndBecomeCreator(uniqueHandle("xander"));
    const creatorB = await loginAndBecomeCreator(uniqueHandle("yuki"));
    const postId = await createPostFor(creatorB, { text: "not yours" });

    const response = await creatorA.app.inject({
      method: "PATCH",
      url: `/creators/me/posts/${postId}`,
      cookies: { ff_session: creatorA.sessionId },
      headers: { "x-csrf-token": creatorA.csrfToken },
      payload: { visibility: "PUBLIC", text: "hijacked" },
    });
    expect(response.statusCode).toBe(404);

    await creatorA.app.close();
    await creatorB.app.close();
    await cleanupUser(creatorA.did);
    await cleanupUser(creatorB.did);
  });

  it("rejects empty text", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("zia"));
    const postId = await createPostFor(creator);
    const response = await creator.app.inject({
      method: "PATCH",
      url: `/creators/me/posts/${postId}`,
      cookies: { ff_session: creator.sessionId },
      headers: { "x-csrf-token": creator.csrfToken },
      payload: { visibility: "PUBLIC", text: "   " },
    });
    expect(response.statusCode).toBe(400);
    await creator.app.close();
    await cleanupUser(creator.did);
  });
});

describe("DELETE /creators/me/posts/:id", () => {
  it("requires authentication", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("kelly"));
    const postId = await createPostFor(creator);
    const response = await creator.app.inject({ method: "DELETE", url: `/creators/me/posts/${postId}` });
    expect(response.statusCode).toBe(401);
    await creator.app.close();
    await cleanupUser(creator.did);
  });

  it("never lets one creator delete another creator's post", async () => {
    const creatorA = await loginAndBecomeCreator(uniqueHandle("liam"));
    const creatorB = await loginAndBecomeCreator(uniqueHandle("mona"));
    const postId = await createPostFor(creatorB);

    const response = await creatorA.app.inject({
      method: "DELETE",
      url: `/creators/me/posts/${postId}`,
      cookies: { ff_session: creatorA.sessionId },
      headers: { "x-csrf-token": creatorA.csrfToken },
    });
    expect(response.statusCode).toBe(404);

    await creatorA.app.close();
    await creatorB.app.close();
    await cleanupUser(creatorA.did);
    await cleanupUser(creatorB.did);
  });

  it("soft-deletes a PUBLIC post and retracts its AT record", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("noah"));
    const postId = await createPostFor(creator, { visibility: "PUBLIC" });

    const response = await creator.app.inject({
      method: "DELETE",
      url: `/creators/me/posts/${postId}`,
      cookies: { ff_session: creator.sessionId },
      headers: { "x-csrf-token": creator.csrfToken },
    });
    expect(response.statusCode).toBe(204);
    expect(creator.deleteCalls.some((c) => c.collection === "fans.foryour.post")).toBe(true);

    const getResponse = await creator.app.inject({ method: "GET", url: `/posts/${postId}` });
    expect(getResponse.statusCode).toBe(404);

    await creator.app.close();
    await cleanupUser(creator.did);
  });
});

describe("GET /posts/:id — access control", () => {
  it("anonymous user gets a locked stub for paid content — no body text or media", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("owen"));
    const postId = await createPostFor(creator, { visibility: "SUBSCRIBERS", text: "secret body" });

    const response = await creator.app.inject({ method: "GET", url: `/posts/${postId}` });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({ id: postId, visibility: "SUBSCRIBERS", locked: true, requiredTier: null });
    expect(body).not.toHaveProperty("text");
    expect(body).not.toHaveProperty("media");
    expect(JSON.stringify(body)).not.toContain("secret body");
    expect(body.creator).toMatchObject({ did: creator.did });

    await creator.app.close();
    await cleanupUser(creator.did);
  });

  it("a logged-in non-subscriber gets a locked stub for paid content", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("penny"));
    const postId = await createPostFor(creator, { visibility: "SUBSCRIBERS", text: "secret body" });
    const stranger = await loginNewUser(uniqueHandle("quinn"));

    const response = await stranger.app.inject({
      method: "GET",
      url: `/posts/${postId}`,
      cookies: { ff_session: stranger.sessionId },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({ locked: true });
    expect(body).not.toHaveProperty("text");
    expect(JSON.stringify(body)).not.toContain("secret body");

    await creator.app.close();
    await stranger.app.close();
    await cleanupUser(creator.did);
    await cleanupUser(stranger.did);
  });

  it("a valid ACTIVE subscriber can access SUBSCRIBERS-visibility content", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("rosa"));
    const tierId = await createTierFor(creator);
    const postId = await createPostFor(creator, { visibility: "SUBSCRIBERS", text: "for subscribers" });
    const subscriber = await loginNewUser(uniqueHandle("sam"));
    await subscribeAndActivate(subscriber, creator, tierId);

    const response = await subscriber.app.inject({
      method: "GET",
      url: `/posts/${postId}`,
      cookies: { ff_session: subscriber.sessionId },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ text: "for subscribers" });

    await creator.app.close();
    await subscriber.app.close();
    await cleanupUser(creator.did);
    await cleanupUser(subscriber.did);
  });

  it("a lower-tier subscriber cannot access higher-tier content", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("tina"));
    const lowTierId = await createTierFor(creator, { name: "Bronze", priceCents: 300 });
    const highTierId = await createTierFor(creator, { name: "Gold", priceCents: 3000 });
    // sortOrder isn't set explicitly by createTierFor, so both default to 0 —
    // give the "higher" tier a real higher sortOrder via a direct PATCH.
    await creator.app.inject({
      method: "PATCH",
      url: `/creators/me/tiers/${highTierId}`,
      cookies: { ff_session: creator.sessionId },
      headers: { "x-csrf-token": creator.csrfToken },
      payload: { sortOrder: 10 },
    });

    const postId = await createPostFor(creator, { visibility: "TIER", minimumTierId: highTierId, text: "gold only" });
    const subscriber = await loginNewUser(uniqueHandle("uma"));
    await subscribeAndActivate(subscriber, creator, lowTierId);

    const response = await subscriber.app.inject({
      method: "GET",
      url: `/posts/${postId}`,
      cookies: { ff_session: subscriber.sessionId },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body).toMatchObject({ locked: true, visibility: "TIER", requiredTier: { name: "Gold" } });
    expect(body).not.toHaveProperty("text");
    expect(JSON.stringify(body)).not.toContain("gold only");

    await creator.app.close();
    await subscriber.app.close();
    await cleanupUser(creator.did);
    await cleanupUser(subscriber.did);
  });

  it("a matching-or-higher-tier subscriber CAN access TIER content", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("victor"));
    const tierId = await createTierFor(creator);
    const postId = await createPostFor(creator, { visibility: "TIER", minimumTierId: tierId, text: "gated" });
    const subscriber = await loginNewUser(uniqueHandle("wendy"));
    await subscribeAndActivate(subscriber, creator, tierId);

    const response = await subscriber.app.inject({
      method: "GET",
      url: `/posts/${postId}`,
      cookies: { ff_session: subscriber.sessionId },
    });
    expect(response.statusCode).toBe(200);

    await creator.app.close();
    await subscriber.app.close();
    await cleanupUser(creator.did);
    await cleanupUser(subscriber.did);
  });

  it("a creator can always access their own gated content, without a subscription", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("xena"));
    const tierId = await createTierFor(creator);
    const postId = await createPostFor(creator, { visibility: "TIER", minimumTierId: tierId, text: "mine" });

    const response = await creator.app.inject({
      method: "GET",
      url: `/posts/${postId}`,
      cookies: { ff_session: creator.sessionId },
    });
    expect(response.statusCode).toBe(200);

    await creator.app.close();
    await cleanupUser(creator.did);
  });

  it("anyone, including anonymous, can access a PUBLIC post", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("yara"));
    const postId = await createPostFor(creator, { visibility: "PUBLIC", text: "public post" });

    const response = await creator.app.inject({ method: "GET", url: `/posts/${postId}` });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ text: "public post" });

    await creator.app.close();
    await cleanupUser(creator.did);
  });

  it("returns 404 for a nonexistent post", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("zack"));
    const response = await creator.app.inject({ method: "GET", url: "/posts/00000000-0000-0000-0000-000000000000" });
    expect(response.statusCode).toBe(404);
    await creator.app.close();
    await cleanupUser(creator.did);
  });
});

describe("GET /creators/:identifier/posts", () => {
  it("returns 404 for an unknown creator", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("amy"));
    const response = await creator.app.inject({ method: "GET", url: "/creators/no-such-creator-xyz/posts" });
    expect(response.statusCode).toBe(404);
    await creator.app.close();
    await cleanupUser(creator.did);
  });

  it("an anonymous viewer sees only PUBLIC posts", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("brad"));
    await createPostFor(creator, { visibility: "PUBLIC", text: "public one" });
    await createPostFor(creator, { visibility: "SUBSCRIBERS", text: "paid one" });

    const response = await creator.app.inject({ method: "GET", url: `/creators/${creator.handle}/posts` });
    expect(response.statusCode).toBe(200);
    const posts = response.json() as Array<{ text: string }>;
    expect(posts.map((p) => p.text)).toEqual(["public one"]);

    await creator.app.close();
    await cleanupUser(creator.did);
  });

  it("an active subscriber sees PUBLIC and SUBSCRIBERS posts, but not a higher TIER post", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("cara"));
    const lowTierId = await createTierFor(creator, { name: "Bronze" });
    const highTierId = await createTierFor(creator, { name: "Gold" });
    await creator.app.inject({
      method: "PATCH",
      url: `/creators/me/tiers/${highTierId}`,
      cookies: { ff_session: creator.sessionId },
      headers: { "x-csrf-token": creator.csrfToken },
      payload: { sortOrder: 10 },
    });
    await createPostFor(creator, { visibility: "PUBLIC", text: "public" });
    await createPostFor(creator, { visibility: "SUBSCRIBERS", text: "subscribers-only" });
    await createPostFor(creator, { visibility: "TIER", minimumTierId: highTierId, text: "gold-only" });

    const subscriber = await loginNewUser(uniqueHandle("dina"));
    await subscribeAndActivate(subscriber, creator, lowTierId);

    const response = await subscriber.app.inject({
      method: "GET",
      url: `/creators/${creator.handle}/posts`,
      cookies: { ff_session: subscriber.sessionId },
    });
    expect(response.statusCode).toBe(200);
    const posts = (response.json() as Array<{ text: string }>).map((p) => p.text).sort();
    expect(posts).toEqual(["public", "subscribers-only"]);

    await creator.app.close();
    await subscriber.app.close();
    await cleanupUser(creator.did);
    await cleanupUser(subscriber.did);
  });

  it("the creator sees every one of their own posts, including gated ones", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("evan"));
    const tierId = await createTierFor(creator);
    await createPostFor(creator, { visibility: "PUBLIC", text: "public" });
    await createPostFor(creator, { visibility: "SUBSCRIBERS", text: "subs" });
    await createPostFor(creator, { visibility: "TIER", minimumTierId: tierId, text: "tier" });

    const response = await creator.app.inject({
      method: "GET",
      url: `/creators/${creator.handle}/posts`,
      cookies: { ff_session: creator.sessionId },
    });
    expect(response.statusCode).toBe(200);
    expect((response.json() as unknown[]).length).toBe(3);

    await creator.app.close();
    await cleanupUser(creator.did);
  });
});

describe("post media attachments (WEB PHASE 8)", () => {
  async function post(creator: Awaited<ReturnType<typeof loginAndBecomeCreator>>, payload: unknown) {
    return creator.app.inject({
      method: "POST",
      url: "/creators/me/posts",
      cookies: { ff_session: creator.sessionId },
      headers: { "x-csrf-token": creator.csrfToken },
      payload: payload as Record<string, unknown>,
    });
  }

  it("attaches READY media to a new post, normalising sortOrder to a dense 0..n-1", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("mia"));
    const a = await createReadyMediaFor(creator);
    const b = await createReadyMediaFor(creator);

    const response = await post(creator, {
      visibility: "SUBSCRIBERS",
      text: "with two attachments",
      media: [
        { mediaAssetId: b, sortOrder: 5 },
        { mediaAssetId: a, sortOrder: 2 },
      ],
    });
    expect(response.statusCode).toBe(201);
    const body = response.json() as { media: Array<{ mediaAssetId: string; sortOrder: number }> };
    expect(body.media).toEqual([
      { mediaAssetId: a, sortOrder: 0 },
      { mediaAssetId: b, sortOrder: 1 },
    ]);

    await creator.app.close();
    await cleanupUser(creator.did);
  });

  it("rejects an unknown media asset id", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("nate"));
    const response = await post(creator, {
      visibility: "PUBLIC",
      text: "ghost attachment",
      media: [{ mediaAssetId: "00000000-0000-0000-0000-000000000000", sortOrder: 0 }],
    });
    expect(response.statusCode).toBe(400);

    await creator.app.close();
    await cleanupUser(creator.did);
  });

  it("rejects a media asset that is not READY", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("nora"));
    const uploadResponse = await creator.app.inject({
      method: "POST",
      url: "/media/upload-url",
      cookies: { ff_session: creator.sessionId },
      headers: { "x-csrf-token": creator.csrfToken },
      payload: { mimeType: "image/png", size: 1024 },
    });
    const { id: pendingId } = uploadResponse.json() as { id: string };

    const response = await post(creator, {
      visibility: "PUBLIC",
      text: "too soon",
      media: [{ mediaAssetId: pendingId, sortOrder: 0 }],
    });
    expect(response.statusCode).toBe(400);

    await creator.app.close();
    await cleanupUser(creator.did);
  });

  it("PATCH replaces attachments; omitting `media` leaves them unchanged; `[]` clears them", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("omar"));
    const a = await createReadyMediaFor(creator);
    const b = await createReadyMediaFor(creator);

    const created = await post(creator, { visibility: "SUBSCRIBERS", text: "v1", media: [{ mediaAssetId: a, sortOrder: 0 }] });
    const postId = (created.json() as { id: string }).id;

    const patch = (payload: unknown) =>
      creator.app.inject({
        method: "PATCH",
        url: `/creators/me/posts/${postId}`,
        cookies: { ff_session: creator.sessionId },
        headers: { "x-csrf-token": creator.csrfToken },
        payload: payload as Record<string, unknown>,
      });

    // Omit media → unchanged.
    let res = await patch({ visibility: "SUBSCRIBERS", text: "v2" });
    expect((res.json() as { media: unknown[] }).media).toHaveLength(1);

    // Replace.
    res = await patch({ visibility: "SUBSCRIBERS", text: "v3", media: [{ mediaAssetId: b, sortOrder: 0 }] });
    expect((res.json() as { media: Array<{ mediaAssetId: string }> }).media).toEqual([{ mediaAssetId: b, sortOrder: 0 }]);

    // Clear.
    res = await patch({ visibility: "SUBSCRIBERS", text: "v4", media: [] });
    expect((res.json() as { media: unknown[] }).media).toHaveLength(0);

    await creator.app.close();
    await cleanupUser(creator.did);
  });

  it("GET /posts/:id returns media for the creator and a locked stub reports hasMedia only", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("posy"));
    const a = await createReadyMediaFor(creator);
    const created = await post(creator, { visibility: "SUBSCRIBERS", text: "gated + media", media: [{ mediaAssetId: a, sortOrder: 0 }] });
    const postId = (created.json() as { id: string }).id;

    const asCreator = await creator.app.inject({
      method: "GET",
      url: `/posts/${postId}`,
      cookies: { ff_session: creator.sessionId },
    });
    expect((asCreator.json() as { media: unknown[] }).media).toHaveLength(1);

    const stranger = await loginNewUser(uniqueHandle("quill"));
    const asStranger = await stranger.app.inject({
      method: "GET",
      url: `/posts/${postId}`,
      cookies: { ff_session: stranger.sessionId },
    });
    const stub = asStranger.json() as { locked: boolean; hasMedia: boolean };
    expect(stub.locked).toBe(true);
    expect(stub.hasMedia).toBe(true);
    expect(asStranger.json()).not.toHaveProperty("media");

    await creator.app.close();
    await stranger.app.close();
    await cleanupUser(creator.did);
    await cleanupUser(stranger.did);
  });
});
