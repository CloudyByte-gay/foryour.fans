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

describe("GET /feed", () => {
  it("an anonymous caller sees PUBLIC posts from any creator", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("alice"));
    await createPostFor(creator, { visibility: "PUBLIC", text: "hello world" });

    const response = await creator.app.inject({ method: "GET", url: "/feed" });
    expect(response.statusCode).toBe(200);
    const posts = response.json() as Array<{ text: string }>;
    expect(posts.map((p) => p.text)).toContain("hello world");

    await creator.app.close();
    await cleanupUser(creator.did);
  });

  it("an anonymous caller never sees SUBSCRIBERS/TIER posts", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("bob"));
    await createPostFor(creator, { visibility: "SUBSCRIBERS", text: "gated" });

    const response = await creator.app.inject({ method: "GET", url: "/feed" });
    const posts = response.json() as Array<{ text: string }>;
    expect(posts.map((p) => p.text)).not.toContain("gated");

    await creator.app.close();
    await cleanupUser(creator.did);
  });

  it("a logged-in non-subscriber sees PUBLIC posts but not a creator's SUBSCRIBERS post", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("carol"));
    await createPostFor(creator, { visibility: "PUBLIC", text: "public one" });
    await createPostFor(creator, { visibility: "SUBSCRIBERS", text: "gated one" });
    const stranger = await loginNewUser(uniqueHandle("dave"));

    const response = await stranger.app.inject({
      method: "GET",
      url: "/feed",
      cookies: { ff_session: stranger.sessionId },
    });
    const posts = response.json() as Array<{ text: string }>;
    expect(posts.map((p) => p.text)).toContain("public one");
    expect(posts.map((p) => p.text)).not.toContain("gated one");

    await creator.app.close();
    await stranger.app.close();
    await cleanupUser(creator.did);
    await cleanupUser(stranger.did);
  });

  it("an ACTIVE subscriber sees an unlocked SUBSCRIBERS post from the subscribed creator", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("erin"));
    const tierId = await createTierFor(creator);
    await createPostFor(creator, { visibility: "SUBSCRIBERS", text: "unlocked for subscribers" });
    const subscriber = await loginNewUser(uniqueHandle("frank"));
    await subscribeAndActivate(subscriber, creator, tierId);

    const response = await subscriber.app.inject({
      method: "GET",
      url: "/feed",
      cookies: { ff_session: subscriber.sessionId },
    });
    const posts = response.json() as Array<{ text: string }>;
    expect(posts.map((p) => p.text)).toContain("unlocked for subscribers");

    await creator.app.close();
    await subscriber.app.close();
    await cleanupUser(creator.did);
    await cleanupUser(subscriber.did);
  });

  it("a lower-tier subscriber does not see a higher-tier-gated post, even from a creator they're subscribed to", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("gwen"));
    const lowTierId = await createTierFor(creator, { name: "Bronze" });
    const highTierId = await createTierFor(creator, { name: "Gold" });
    await creator.app.inject({
      method: "PATCH",
      url: `/creators/me/tiers/${highTierId}`,
      cookies: { ff_session: creator.sessionId },
      headers: { "x-csrf-token": creator.csrfToken },
      payload: { sortOrder: 10 },
    });
    await createPostFor(creator, { visibility: "TIER", minimumTierId: highTierId, text: "gold only" });
    const subscriber = await loginNewUser(uniqueHandle("henry"));
    await subscribeAndActivate(subscriber, creator, lowTierId);

    const response = await subscriber.app.inject({
      method: "GET",
      url: "/feed",
      cookies: { ff_session: subscriber.sessionId },
    });
    const posts = response.json() as Array<{ text: string }>;
    expect(posts.map((p) => p.text)).not.toContain("gold only");

    await creator.app.close();
    await subscriber.app.close();
    await cleanupUser(creator.did);
    await cleanupUser(subscriber.did);
  });

  it("excludes posts from a SUSPENDED creator", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("iris"));
    await createPostFor(creator, { visibility: "PUBLIC", text: "before suspension" });
    await prisma.creator.update({ where: { did: creator.did }, data: { status: "SUSPENDED" } });

    const response = await creator.app.inject({ method: "GET", url: "/feed" });
    const posts = response.json() as Array<{ text: string }>;
    expect(posts.map((p) => p.text)).not.toContain("before suspension");

    await creator.app.close();
    await cleanupUser(creator.did);
  });

  it("embeds the post's creator identity (did, handle)", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("jack"));
    await createPostFor(creator, { visibility: "PUBLIC", text: "who wrote this" });

    const response = await creator.app.inject({ method: "GET", url: "/feed" });
    const posts = response.json() as Array<{ text: string; creator: { did: string; handle: string } }>;
    const found = posts.find((p) => p.text === "who wrote this");
    expect(found?.creator).toMatchObject({ did: creator.did, handle: creator.handle });

    await creator.app.close();
    await cleanupUser(creator.did);
  });

  it("respects the limit query param", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("kelly"));
    await createPostFor(creator, { visibility: "PUBLIC", text: "one" });
    await createPostFor(creator, { visibility: "PUBLIC", text: "two" });
    await createPostFor(creator, { visibility: "PUBLIC", text: "three" });

    const response = await creator.app.inject({ method: "GET", url: "/feed?limit=1" });
    expect(response.statusCode).toBe(200);
    expect((response.json() as unknown[]).length).toBeLessThanOrEqual(1);

    await creator.app.close();
    await cleanupUser(creator.did);
  });

  it("rejects an invalid limit", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("liam"));
    const response = await creator.app.inject({ method: "GET", url: "/feed?limit=not-a-number" });
    expect(response.statusCode).toBe(400);
    await creator.app.close();
    await cleanupUser(creator.did);
  });
});

describe("GET /creators/:identifier/feed", () => {
  it("returns 404 for an unknown creator", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("mona"));
    const response = await creator.app.inject({ method: "GET", url: "/creators/no-such-creator-xyz/feed" });
    expect(response.statusCode).toBe(404);
    await creator.app.close();
    await cleanupUser(creator.did);
  });

  it("an anonymous viewer gets a full PUBLIC post and a locked stub for a SUBSCRIBERS post", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("noah"));
    await createPostFor(creator, { visibility: "PUBLIC", text: "public post" });
    await createPostFor(creator, { visibility: "SUBSCRIBERS", text: "gated post" });

    const response = await creator.app.inject({ method: "GET", url: `/creators/${creator.handle}/feed` });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { posts: Array<Record<string, unknown>> };
    expect(body.posts).toHaveLength(2);

    const publicEntry = body.posts.find((p) => p.locked === false);
    expect(publicEntry).toMatchObject({ text: "public post", locked: false });

    const lockedEntry = body.posts.find((p) => p.locked === true);
    expect(lockedEntry).toBeDefined();
    expect(lockedEntry).not.toHaveProperty("text");
    expect(lockedEntry).not.toHaveProperty("media");
    expect(lockedEntry?.requiredTier).toBeNull();

    await creator.app.close();
    await cleanupUser(creator.did);
  });

  it("a locked TIER post's stub includes safe requiredTier metadata", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("owen"));
    const tierId = await createTierFor(creator, { name: "VIP", priceCents: 1500, currency: "usd" });
    await createPostFor(creator, { visibility: "TIER", minimumTierId: tierId, text: "vip only" });

    const response = await creator.app.inject({ method: "GET", url: `/creators/${creator.handle}/feed` });
    const body = response.json() as { posts: Array<Record<string, unknown>> };
    const lockedEntry = body.posts.find((p) => p.locked === true);
    expect(lockedEntry?.requiredTier).toMatchObject({ id: tierId, name: "VIP", priceCents: 1500, currency: "usd" });
    expect(lockedEntry).not.toHaveProperty("text");

    await creator.app.close();
    await cleanupUser(creator.did);
  });

  it("the creator sees every one of their own posts fully unlocked, never a locked stub", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("penny"));
    const tierId = await createTierFor(creator);
    await createPostFor(creator, { visibility: "PUBLIC", text: "public" });
    await createPostFor(creator, { visibility: "SUBSCRIBERS", text: "subs" });
    await createPostFor(creator, { visibility: "TIER", minimumTierId: tierId, text: "tier" });

    const response = await creator.app.inject({
      method: "GET",
      url: `/creators/${creator.handle}/feed`,
      cookies: { ff_session: creator.sessionId },
    });
    const body = response.json() as { posts: Array<{ locked: boolean }> };
    expect(body.posts.every((p) => p.locked === false)).toBe(true);

    await creator.app.close();
    await cleanupUser(creator.did);
  });

  it("an ACTIVE subscriber sees an unlocked SUBSCRIBERS post as full, not a stub", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("quinn"));
    const tierId = await createTierFor(creator);
    await createPostFor(creator, { visibility: "SUBSCRIBERS", text: "for subscribers" });
    const subscriber = await loginNewUser(uniqueHandle("rosa"));
    await subscribeAndActivate(subscriber, creator, tierId);

    const response = await subscriber.app.inject({
      method: "GET",
      url: `/creators/${creator.handle}/feed`,
      cookies: { ff_session: subscriber.sessionId },
    });
    const body = response.json() as { posts: Array<Record<string, unknown>> };
    expect(body.posts).toMatchObject([{ text: "for subscribers", locked: false }]);

    await creator.app.close();
    await subscriber.app.close();
    await cleanupUser(creator.did);
    await cleanupUser(subscriber.did);
  });

  it("cursor pagination returns every post exactly once, in order, across pages", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("sam"));
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      ids.push(await createPostFor(creator, { visibility: "PUBLIC", text: `post ${i}` }));
    }
    for (const [i, id] of ids.entries()) {
      await prisma.post.update({ where: { id }, data: { createdAt: new Date(Date.now() - (5 - i) * 60_000) } });
    }
    const expectedOrder = [...ids].reverse();

    const page1 = await creator.app.inject({ method: "GET", url: `/creators/${creator.handle}/feed?limit=2` });
    const body1 = page1.json() as { posts: Array<{ id: string }>; nextCursor: string };
    expect(body1.posts.map((p) => p.id)).toEqual(expectedOrder.slice(0, 2));

    const page2 = await creator.app.inject({
      method: "GET",
      url: `/creators/${creator.handle}/feed?limit=2&cursor=${body1.nextCursor}`,
    });
    const body2 = page2.json() as { posts: Array<{ id: string }>; nextCursor: string };
    expect(body2.posts.map((p) => p.id)).toEqual(expectedOrder.slice(2, 4));

    const page3 = await creator.app.inject({
      method: "GET",
      url: `/creators/${creator.handle}/feed?limit=2&cursor=${body2.nextCursor}`,
    });
    const body3 = page3.json() as { posts: Array<{ id: string }>; nextCursor: string | null };
    expect(body3.posts.map((p) => p.id)).toEqual(expectedOrder.slice(4, 5));

    const page4 = await creator.app.inject({
      method: "GET",
      url: `/creators/${creator.handle}/feed?limit=2&cursor=${body3.nextCursor}`,
    });
    const body4 = page4.json() as { posts: Array<{ id: string }>; nextCursor: string | null };
    expect(body4.posts).toHaveLength(0);
    expect(body4.nextCursor).toBeNull();

    await creator.app.close();
    await cleanupUser(creator.did);
  });

  it("rejects a cursor that belongs to a different creator", async () => {
    const creatorA = await loginAndBecomeCreator(uniqueHandle("tara"));
    const creatorB = await loginAndBecomeCreator(uniqueHandle("uma"));
    const postIdB = await createPostFor(creatorB, { visibility: "PUBLIC" });

    const response = await creatorA.app.inject({
      method: "GET",
      url: `/creators/${creatorA.handle}/feed?cursor=${postIdB}`,
    });
    expect(response.statusCode).toBe(400);

    await creatorA.app.close();
    await creatorB.app.close();
    await cleanupUser(creatorA.did);
    await cleanupUser(creatorB.did);
  });

  it("rejects a cursor that doesn't exist at all", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("victor"));
    const response = await creator.app.inject({
      method: "GET",
      url: `/creators/${creator.handle}/feed?cursor=00000000-0000-0000-0000-000000000000`,
    });
    expect(response.statusCode).toBe(400);
    await creator.app.close();
    await cleanupUser(creator.did);
  });
});
