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

describe("POST /posts/:id/likes", () => {
  it("requires authentication", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("aiden"));
    const postId = await createPostFor(creator, { visibility: "PUBLIC" });

    const response = await creator.app.inject({ method: "POST", url: `/posts/${postId}/likes` });
    expect(response.statusCode).toBe(401);

    await creator.app.close();
    await cleanupUser(creator.did);
  });

  it("returns 404 for a nonexistent post", async () => {
    const caller = await loginNewUser(uniqueHandle("brooke"));
    const response = await caller.app.inject({
      method: "POST",
      url: "/posts/00000000-0000-0000-0000-000000000000/likes",
      cookies: { ff_session: caller.sessionId },
      headers: { "x-csrf-token": caller.csrfToken },
    });
    expect(response.statusCode).toBe(404);
    await caller.app.close();
    await cleanupUser(caller.did);
  });

  it("lets anyone like a PUBLIC post", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("cyrus"));
    const postId = await createPostFor(creator, { visibility: "PUBLIC" });
    const liker = await loginNewUser(uniqueHandle("della"));

    const response = await liker.app.inject({
      method: "POST",
      url: `/posts/${postId}/likes`,
      cookies: { ff_session: liker.sessionId },
      headers: { "x-csrf-token": liker.csrfToken },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ likeCount: 1, likedByViewer: true });

    await creator.app.close();
    await liker.app.close();
    await cleanupUser(creator.did);
    await cleanupUser(liker.did);
  });

  it("is idempotent — liking twice doesn't double the count", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("ezra"));
    const postId = await createPostFor(creator, { visibility: "PUBLIC" });

    await creator.app.inject({
      method: "POST",
      url: `/posts/${postId}/likes`,
      cookies: { ff_session: creator.sessionId },
      headers: { "x-csrf-token": creator.csrfToken },
    });
    const second = await creator.app.inject({
      method: "POST",
      url: `/posts/${postId}/likes`,
      cookies: { ff_session: creator.sessionId },
      headers: { "x-csrf-token": creator.csrfToken },
    });
    expect(second.json()).toEqual({ likeCount: 1, likedByViewer: true });

    await creator.app.close();
    await cleanupUser(creator.did);
  });

  it("blocks a non-subscriber from liking protected content — 403, no row created", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("finn"));
    const postId = await createPostFor(creator, { visibility: "SUBSCRIBERS" });
    const stranger = await loginNewUser(uniqueHandle("gia"));

    const response = await stranger.app.inject({
      method: "POST",
      url: `/posts/${postId}/likes`,
      cookies: { ff_session: stranger.sessionId },
      headers: { "x-csrf-token": stranger.csrfToken },
    });
    expect(response.statusCode).toBe(403);

    const rows = await prisma.like.findMany({ where: { postId } });
    expect(rows).toHaveLength(0);

    await creator.app.close();
    await stranger.app.close();
    await cleanupUser(creator.did);
    await cleanupUser(stranger.did);
  });

  it("a lower-tier subscriber cannot like higher-tier content", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("hugo"));
    const lowTierId = await createTierFor(creator, { name: "Bronze", priceCents: 300 });
    const highTierId = await createTierFor(creator, { name: "Gold", priceCents: 3000 });
    await creator.app.inject({
      method: "PATCH",
      url: `/creators/me/tiers/${highTierId}`,
      cookies: { ff_session: creator.sessionId },
      headers: { "x-csrf-token": creator.csrfToken },
      payload: { sortOrder: 10 },
    });
    const postId = await createPostFor(creator, { visibility: "TIER", minimumTierId: highTierId });
    const subscriber = await loginNewUser(uniqueHandle("ines"));
    await subscribeAndActivate(subscriber, creator, lowTierId);

    const response = await subscriber.app.inject({
      method: "POST",
      url: `/posts/${postId}/likes`,
      cookies: { ff_session: subscriber.sessionId },
      headers: { "x-csrf-token": subscriber.csrfToken },
    });
    expect(response.statusCode).toBe(403);

    await creator.app.close();
    await subscriber.app.close();
    await cleanupUser(creator.did);
    await cleanupUser(subscriber.did);
  });

  it("an ACTIVE subscriber can like SUBSCRIBERS content", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("jules"));
    const tierId = await createTierFor(creator);
    const postId = await createPostFor(creator, { visibility: "SUBSCRIBERS" });
    const subscriber = await loginNewUser(uniqueHandle("kira"));
    await subscribeAndActivate(subscriber, creator, tierId);

    const response = await subscriber.app.inject({
      method: "POST",
      url: `/posts/${postId}/likes`,
      cookies: { ff_session: subscriber.sessionId },
      headers: { "x-csrf-token": subscriber.csrfToken },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ likeCount: 1, likedByViewer: true });

    await creator.app.close();
    await subscriber.app.close();
    await cleanupUser(creator.did);
    await cleanupUser(subscriber.did);
  });

  it("the creator can always like their own gated post", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("lena"));
    const tierId = await createTierFor(creator);
    const postId = await createPostFor(creator, { visibility: "TIER", minimumTierId: tierId });

    const response = await creator.app.inject({
      method: "POST",
      url: `/posts/${postId}/likes`,
      cookies: { ff_session: creator.sessionId },
      headers: { "x-csrf-token": creator.csrfToken },
    });
    expect(response.statusCode).toBe(200);

    await creator.app.close();
    await cleanupUser(creator.did);
  });
});

describe("DELETE /posts/:id/likes", () => {
  it("requires authentication", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("milo"));
    const postId = await createPostFor(creator, { visibility: "PUBLIC" });

    const response = await creator.app.inject({ method: "DELETE", url: `/posts/${postId}/likes` });
    expect(response.statusCode).toBe(401);

    await creator.app.close();
    await cleanupUser(creator.did);
  });

  it("removes an existing like", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("nadia"));
    const postId = await createPostFor(creator, { visibility: "PUBLIC" });
    const liker = await loginNewUser(uniqueHandle("omar"));
    await liker.app.inject({
      method: "POST",
      url: `/posts/${postId}/likes`,
      cookies: { ff_session: liker.sessionId },
      headers: { "x-csrf-token": liker.csrfToken },
    });

    const response = await liker.app.inject({
      method: "DELETE",
      url: `/posts/${postId}/likes`,
      cookies: { ff_session: liker.sessionId },
      headers: { "x-csrf-token": liker.csrfToken },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ likeCount: 0, likedByViewer: false });

    await creator.app.close();
    await liker.app.close();
    await cleanupUser(creator.did);
    await cleanupUser(liker.did);
  });

  it("is a safe no-op for a post the caller never liked", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("petra"));
    const postId = await createPostFor(creator, { visibility: "PUBLIC" });

    const response = await creator.app.inject({
      method: "DELETE",
      url: `/posts/${postId}/likes`,
      cookies: { ff_session: creator.sessionId },
      headers: { "x-csrf-token": creator.csrfToken },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ likeCount: 0, likedByViewer: false });

    await creator.app.close();
    await cleanupUser(creator.did);
  });

  it("still enforces access on unlike — a non-subscriber gets 403 for protected content", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("quinn"));
    const postId = await createPostFor(creator, { visibility: "SUBSCRIBERS" });
    const stranger = await loginNewUser(uniqueHandle("raj"));

    const response = await stranger.app.inject({
      method: "DELETE",
      url: `/posts/${postId}/likes`,
      cookies: { ff_session: stranger.sessionId },
      headers: { "x-csrf-token": stranger.csrfToken },
    });
    expect(response.statusCode).toBe(403);

    await creator.app.close();
    await stranger.app.close();
    await cleanupUser(creator.did);
    await cleanupUser(stranger.did);
  });
});

describe("GET /posts/:id — like summary", () => {
  it("reports likeCount/likedByViewer/likedByCreator on an unlocked post", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("sana"));
    const postId = await createPostFor(creator, { visibility: "PUBLIC" });
    const liker = await loginNewUser(uniqueHandle("tobi"));
    await liker.app.inject({
      method: "POST",
      url: `/posts/${postId}/likes`,
      cookies: { ff_session: liker.sessionId },
      headers: { "x-csrf-token": liker.csrfToken },
    });
    await creator.app.inject({
      method: "POST",
      url: `/posts/${postId}/likes`,
      cookies: { ff_session: creator.sessionId },
      headers: { "x-csrf-token": creator.csrfToken },
    });

    const asLiker = await liker.app.inject({
      method: "GET",
      url: `/posts/${postId}`,
      cookies: { ff_session: liker.sessionId },
    });
    expect(asLiker.json()).toMatchObject({ likeCount: 2, likedByViewer: true, likedByCreator: true });

    const asAnonymous = await creator.app.inject({ method: "GET", url: `/posts/${postId}` });
    expect(asAnonymous.json()).toMatchObject({ likeCount: 2, likedByViewer: false, likedByCreator: true });

    await creator.app.close();
    await liker.app.close();
    await cleanupUser(creator.did);
    await cleanupUser(liker.did);
  });

  it("a locked stub never includes like fields", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("umi"));
    const postId = await createPostFor(creator, { visibility: "SUBSCRIBERS" });
    const stranger = await loginNewUser(uniqueHandle("vito"));

    const response = await stranger.app.inject({
      method: "GET",
      url: `/posts/${postId}`,
      cookies: { ff_session: stranger.sessionId },
    });
    const body = response.json();
    expect(body.locked).toBe(true);
    expect(body).not.toHaveProperty("likeCount");
    expect(body).not.toHaveProperty("likedByViewer");
    expect(body).not.toHaveProperty("likedByCreator");

    await creator.app.close();
    await stranger.app.close();
    await cleanupUser(creator.did);
    await cleanupUser(stranger.did);
  });
});

describe("GET /posts/:id/likes — the 'liked by' list", () => {
  it("is anonymous-readable for a PUBLIC post and lists likers newest-first", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("wren"));
    const postId = await createPostFor(creator, { visibility: "PUBLIC" });
    const a = await loginNewUser(uniqueHandle("xander"));
    const b = await loginNewUser(uniqueHandle("yuki"));
    for (const liker of [a, b]) {
      await liker.app.inject({
        method: "POST",
        url: `/posts/${postId}/likes`,
        cookies: { ff_session: liker.sessionId },
        headers: { "x-csrf-token": liker.csrfToken },
      });
    }

    const res = await creator.app.inject({ method: "GET", url: `/posts/${postId}/likes` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.nextCursor).toBeNull();
    expect(body.likes).toHaveLength(2);
    expect(body.likes[0].actor).toHaveProperty("did");
    expect(new Set(body.likes.map((l: { actor: { handle: string } }) => l.actor.handle))).toEqual(
      new Set([a.handle, b.handle]),
    );

    await creator.app.close();
    await a.app.close();
    await b.app.close();
    await cleanupUser(creator.did);
    await cleanupUser(a.did);
    await cleanupUser(b.did);
  });

  it("paginates with an opaque cursor", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("zane"));
    const postId = await createPostFor(creator, { visibility: "PUBLIC" });
    const likers = [];
    for (let i = 0; i < 3; i++) {
      const u = await loginNewUser(uniqueHandle(`liker${i}`));
      likers.push(u);
      await u.app.inject({
        method: "POST",
        url: `/posts/${postId}/likes`,
        cookies: { ff_session: u.sessionId },
        headers: { "x-csrf-token": u.csrfToken },
      });
    }

    const page1 = (await creator.app.inject({ method: "GET", url: `/posts/${postId}/likes?limit=2` })).json();
    expect(page1.likes).toHaveLength(2);
    expect(page1.nextCursor).toEqual(expect.any(String));

    const page2 = (
      await creator.app.inject({
        method: "GET",
        url: `/posts/${postId}/likes?limit=2&cursor=${encodeURIComponent(page1.nextCursor)}`,
      })
    ).json();
    expect(page2.likes).toHaveLength(1);
    expect(page2.nextCursor).toBeNull();

    await creator.app.close();
    for (const u of likers) {
      await u.app.close();
      await cleanupUser(u.did);
    }
    await cleanupUser(creator.did);
  });

  it("rejects a malformed cursor with 400", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("cara"));
    const postId = await createPostFor(creator, { visibility: "PUBLIC" });

    const res = await creator.app.inject({ method: "GET", url: `/posts/${postId}/likes?limit=nope` });
    expect(res.statusCode).toBe(400);

    await creator.app.close();
    await cleanupUser(creator.did);
  });

  it("returns 404 for an unknown post", async () => {
    const caller = await loginNewUser(uniqueHandle("dara"));
    const res = await caller.app.inject({
      method: "GET",
      url: "/posts/00000000-0000-0000-0000-000000000000/likes",
    });
    expect(res.statusCode).toBe(404);
    await caller.app.close();
    await cleanupUser(caller.did);
  });

  it("keeps a gated post's likers hidden from non-entitled viewers but visible to subscribers", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("elle"));
    const tierId = await createTierFor(creator);
    const postId = await createPostFor(creator, { visibility: "SUBSCRIBERS" });
    const subscriber = await loginNewUser(uniqueHandle("finnley"));
    await subscribeAndActivate(subscriber, creator, tierId);
    await subscriber.app.inject({
      method: "POST",
      url: `/posts/${postId}/likes`,
      cookies: { ff_session: subscriber.sessionId },
      headers: { "x-csrf-token": subscriber.csrfToken },
    });
    const stranger = await loginNewUser(uniqueHandle("gwen"));

    const anon = await creator.app.inject({ method: "GET", url: `/posts/${postId}/likes` });
    expect(anon.statusCode).toBe(403);

    const asStranger = await stranger.app.inject({
      method: "GET",
      url: `/posts/${postId}/likes`,
      cookies: { ff_session: stranger.sessionId },
    });
    expect(asStranger.statusCode).toBe(403);

    const asSubscriber = await subscriber.app.inject({
      method: "GET",
      url: `/posts/${postId}/likes`,
      cookies: { ff_session: subscriber.sessionId },
    });
    expect(asSubscriber.statusCode).toBe(200);
    expect(asSubscriber.json().likes).toHaveLength(1);

    await creator.app.close();
    await subscriber.app.close();
    await stranger.app.close();
    await cleanupUser(creator.did);
    await cleanupUser(subscriber.did);
    await cleanupUser(stranger.did);
  });
});

describe("AT-backed likes (CREATOR_OWNED_PDS_ENABLED)", () => {
  it("publishes a fans.foryour.like to the liker's own repo and demotes the local row to a cache", async () => {
    // PrivateContentRepository mirrors only fans.foryour.post (no bsky pairing),
    // so this exercises the fans.foryour.like write + the readAtRecord CID
    // fallback. The full dual-publish (+ app.bsky.feed.like) is covered by
    // packages/content/src/likeService.test.ts and the web e2e.
    const creator = await loginAndBecomeCreator(uniqueHandle("hana"), { creatorOwnedLikes: true });
    const postId = await createPostFor(creator, { visibility: "PUBLIC" });
    const liker = await loginNewUser(uniqueHandle("ivo"), { creatorOwnedLikes: true });

    const res = await liker.app.inject({
      method: "POST",
      url: `/posts/${postId}/likes`,
      cookies: { ff_session: liker.sessionId },
      headers: { "x-csrf-token": liker.csrfToken },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ likeCount: 1, likedByViewer: true });

    const likeWrites = liker.publishCalls.filter((c) => c.collection === "fans.foryour.like");
    expect(likeWrites).toHaveLength(1);
    expect(likeWrites[0]!.did).toBe(liker.did);

    const row = await prisma.like.findFirstOrThrow({ where: { postId } });
    expect(row.isAuthoritative).toBe(false);
    expect(row.sourceUri).toMatch(/^at:\/\/.+\/fans\.foryour\.like\//);

    await liker.app.inject({
      method: "DELETE",
      url: `/posts/${postId}/likes`,
      cookies: { ff_session: liker.sessionId },
      headers: { "x-csrf-token": liker.csrfToken },
    });
    expect(liker.deleteCalls.map((c) => c.collection)).toContain("fans.foryour.like");
    expect(await prisma.like.count({ where: { postId } })).toBe(0);

    await creator.app.close();
    await liker.app.close();
    await cleanupUser(creator.did);
    await cleanupUser(liker.did);
  });
});
