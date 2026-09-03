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

describe("POST /posts/:id/comments", () => {
  it("requires authentication", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("aaron"));
    const postId = await createPostFor(creator, { visibility: "PUBLIC" });

    const response = await creator.app.inject({
      method: "POST",
      url: `/posts/${postId}/comments`,
      payload: { text: "hi" },
    });
    expect(response.statusCode).toBe(401);

    await creator.app.close();
    await cleanupUser(creator.did);
  });

  it("returns 404 for a nonexistent post", async () => {
    const commenter = await loginNewUser(uniqueHandle("bianca"));
    const response = await commenter.app.inject({
      method: "POST",
      url: "/posts/00000000-0000-0000-0000-000000000000/comments",
      cookies: { ff_session: commenter.sessionId },
      headers: { "x-csrf-token": commenter.csrfToken },
      payload: { text: "hi" },
    });
    expect(response.statusCode).toBe(404);
    await commenter.app.close();
    await cleanupUser(commenter.did);
  });

  it("lets anyone comment on a PUBLIC post", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("caleb"));
    const postId = await createPostFor(creator, { visibility: "PUBLIC" });
    const commenter = await loginNewUser(uniqueHandle("dana"));

    const response = await commenter.app.inject({
      method: "POST",
      url: `/posts/${postId}/comments`,
      cookies: { ff_session: commenter.sessionId },
      headers: { "x-csrf-token": commenter.csrfToken },
      payload: { text: "great post!" },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      postId,
      text: "great post!",
      author: { did: commenter.did },
    });

    await creator.app.close();
    await commenter.app.close();
    await cleanupUser(creator.did);
    await cleanupUser(commenter.did);
  });

  it("blocks a non-subscriber from commenting on protected content — 403, no row created", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("ellis"));
    const postId = await createPostFor(creator, { visibility: "SUBSCRIBERS", text: "secret" });
    const stranger = await loginNewUser(uniqueHandle("faye"));

    const response = await stranger.app.inject({
      method: "POST",
      url: `/posts/${postId}/comments`,
      cookies: { ff_session: stranger.sessionId },
      headers: { "x-csrf-token": stranger.csrfToken },
      payload: { text: "let me in" },
    });
    expect(response.statusCode).toBe(403);

    const rows = await prisma.comment.findMany({ where: { postId } });
    expect(rows).toHaveLength(0);

    await creator.app.close();
    await stranger.app.close();
    await cleanupUser(creator.did);
    await cleanupUser(stranger.did);
  });

  it("blocks an anonymous caller from commenting on protected content", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("gwen"));
    const postId = await createPostFor(creator, { visibility: "SUBSCRIBERS" });

    // No session cookie at all — requireSession itself rejects this before
    // loadAccessiblePost ever runs, same as every other authenticated route.
    const response = await creator.app.inject({
      method: "POST",
      url: `/posts/${postId}/comments`,
      payload: { text: "let me in" },
    });
    expect(response.statusCode).toBe(401);

    await creator.app.close();
    await cleanupUser(creator.did);
  });

  it("lets an ACTIVE subscriber comment on SUBSCRIBERS content", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("hank"));
    const tierId = await createTierFor(creator);
    const postId = await createPostFor(creator, { visibility: "SUBSCRIBERS" });
    const subscriber = await loginNewUser(uniqueHandle("iris"));
    await subscribeAndActivate(subscriber, creator, tierId);

    const response = await subscriber.app.inject({
      method: "POST",
      url: `/posts/${postId}/comments`,
      cookies: { ff_session: subscriber.sessionId },
      headers: { "x-csrf-token": subscriber.csrfToken },
      payload: { text: "thanks for sharing" },
    });
    expect(response.statusCode).toBe(201);

    await creator.app.close();
    await subscriber.app.close();
    await cleanupUser(creator.did);
    await cleanupUser(subscriber.did);
  });

  it("a lower-tier subscriber cannot comment on higher-tier content", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("jonah"));
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
    const subscriber = await loginNewUser(uniqueHandle("kayla"));
    await subscribeAndActivate(subscriber, creator, lowTierId);

    const response = await subscriber.app.inject({
      method: "POST",
      url: `/posts/${postId}/comments`,
      cookies: { ff_session: subscriber.sessionId },
      headers: { "x-csrf-token": subscriber.csrfToken },
      payload: { text: "let me in" },
    });
    expect(response.statusCode).toBe(403);

    await creator.app.close();
    await subscriber.app.close();
    await cleanupUser(creator.did);
    await cleanupUser(subscriber.did);
  });

  it("the creator can always comment on their own gated post", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("liam"));
    const tierId = await createTierFor(creator);
    const postId = await createPostFor(creator, { visibility: "TIER", minimumTierId: tierId });

    const response = await creator.app.inject({
      method: "POST",
      url: `/posts/${postId}/comments`,
      cookies: { ff_session: creator.sessionId },
      headers: { "x-csrf-token": creator.csrfToken },
      payload: { text: "note to self" },
    });
    expect(response.statusCode).toBe(201);

    await creator.app.close();
    await cleanupUser(creator.did);
  });

  it("rejects empty text", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("mona"));
    const postId = await createPostFor(creator, { visibility: "PUBLIC" });

    const response = await creator.app.inject({
      method: "POST",
      url: `/posts/${postId}/comments`,
      cookies: { ff_session: creator.sessionId },
      headers: { "x-csrf-token": creator.csrfToken },
      payload: { text: "   " },
    });
    expect(response.statusCode).toBe(400);

    await creator.app.close();
    await cleanupUser(creator.did);
  });
});

describe("GET /posts/:id/comments", () => {
  it("returns 404 for a nonexistent post", async () => {
    const caller = await loginNewUser(uniqueHandle("noah"));
    const response = await caller.app.inject({
      method: "GET",
      url: "/posts/00000000-0000-0000-0000-000000000000/comments",
    });
    expect(response.statusCode).toBe(404);
    await caller.app.close();
    await cleanupUser(caller.did);
  });

  it("anyone, including anonymous, can read comments on a PUBLIC post", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("olive"));
    const postId = await createPostFor(creator, { visibility: "PUBLIC" });
    const commenter = await loginNewUser(uniqueHandle("piper"));
    await commenter.app.inject({
      method: "POST",
      url: `/posts/${postId}/comments`,
      cookies: { ff_session: commenter.sessionId },
      headers: { "x-csrf-token": commenter.csrfToken },
      payload: { text: "hello!" },
    });

    const response = await creator.app.inject({ method: "GET", url: `/posts/${postId}/comments` });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { comments: Array<{ id: string; text: string }>; nextCursor: string | null };
    expect(body.comments).toHaveLength(1);
    expect(body.comments[0]?.text).toBe("hello!");
    // nextCursor is the last row's id whenever the page is non-empty — the
    // same "keep paging until an empty page comes back" shape GET /discover
    // and GET /search use; it doesn't mean there IS another page.
    expect(body.nextCursor).toBe(body.comments[0]?.id);

    await creator.app.close();
    await commenter.app.close();
    await cleanupUser(creator.did);
    await cleanupUser(commenter.did);
  });

  it("blocks an anonymous caller from reading comments on protected content — never leaks comment text", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("quincy"));
    const tierId = await createTierFor(creator);
    const postId = await createPostFor(creator, { visibility: "TIER", minimumTierId: tierId });
    const subscriber = await loginNewUser(uniqueHandle("rita"));
    await subscribeAndActivate(subscriber, creator, tierId);
    await subscriber.app.inject({
      method: "POST",
      url: `/posts/${postId}/comments`,
      cookies: { ff_session: subscriber.sessionId },
      headers: { "x-csrf-token": subscriber.csrfToken },
      payload: { text: "very secret comment" },
    });

    const response = await creator.app.inject({ method: "GET", url: `/posts/${postId}/comments` });
    expect(response.statusCode).toBe(403);
    expect(JSON.stringify(response.json())).not.toContain("very secret comment");

    await creator.app.close();
    await subscriber.app.close();
    await cleanupUser(creator.did);
    await cleanupUser(subscriber.did);
  });

  it("blocks a logged-in non-subscriber from reading comments on protected content", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("silas"));
    const postId = await createPostFor(creator, { visibility: "SUBSCRIBERS" });
    const stranger = await loginNewUser(uniqueHandle("tara"));

    const response = await stranger.app.inject({
      method: "GET",
      url: `/posts/${postId}/comments`,
      cookies: { ff_session: stranger.sessionId },
    });
    expect(response.statusCode).toBe(403);

    await creator.app.close();
    await stranger.app.close();
    await cleanupUser(creator.did);
    await cleanupUser(stranger.did);
  });

  it("an ACTIVE subscriber can read comments on SUBSCRIBERS content", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("uriel"));
    const tierId = await createTierFor(creator);
    const postId = await createPostFor(creator, { visibility: "SUBSCRIBERS" });
    const subscriber = await loginNewUser(uniqueHandle("vera"));
    await subscribeAndActivate(subscriber, creator, tierId);

    const response = await subscriber.app.inject({
      method: "GET",
      url: `/posts/${postId}/comments`,
      cookies: { ff_session: subscriber.sessionId },
    });
    expect(response.statusCode).toBe(200);

    await creator.app.close();
    await subscriber.app.close();
    await cleanupUser(creator.did);
    await cleanupUser(subscriber.did);
  });

  it("returns comments oldest-first, cursor-paginated", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("wade"));
    const postId = await createPostFor(creator, { visibility: "PUBLIC" });
    for (const text of ["first", "second", "third"]) {
      await creator.app.inject({
        method: "POST",
        url: `/posts/${postId}/comments`,
        cookies: { ff_session: creator.sessionId },
        headers: { "x-csrf-token": creator.csrfToken },
        payload: { text },
      });
    }

    const firstPage = await creator.app.inject({ method: "GET", url: `/posts/${postId}/comments?limit=2` });
    const firstBody = firstPage.json() as { comments: Array<{ id: string; text: string }>; nextCursor: string | null };
    expect(firstBody.comments.map((c) => c.text)).toEqual(["first", "second"]);
    expect(firstBody.nextCursor).toBe(firstBody.comments[1]!.id);

    const secondPage = await creator.app.inject({
      method: "GET",
      url: `/posts/${postId}/comments?limit=2&cursor=${firstBody.nextCursor}`,
    });
    const secondBody = secondPage.json() as { comments: Array<{ text: string }>; nextCursor: string | null };
    expect(secondBody.comments.map((c) => c.text)).toEqual(["third"]);
    expect(secondBody.nextCursor).not.toBeNull();

    const thirdPage = await creator.app.inject({
      method: "GET",
      url: `/posts/${postId}/comments?limit=2&cursor=${secondBody.nextCursor}`,
    });
    const thirdBody = thirdPage.json() as { comments: Array<{ text: string }>; nextCursor: string | null };
    expect(thirdBody.comments).toEqual([]);
    expect(thirdBody.nextCursor).toBeNull();

    await creator.app.close();
    await cleanupUser(creator.did);
  });
});
