import { afterAll, describe, expect, it } from "vitest";
import { cleanupUser, createPostFor, loginAndBecomeCreator, loginNewUser, prisma, redis, uniqueHandle } from "./helpers.js";

afterAll(async () => {
  await prisma.$disconnect();
  redis.disconnect();
});

describe("POST /blocks", () => {
  it("requires authentication", async () => {
    const { app, did } = await loginNewUser(uniqueHandle("aaron"));
    const response = await app.inject({ method: "POST", url: "/blocks", payload: { identifier: "someone.test" } });
    expect(response.statusCode).toBe(401);
    await app.close();
    await cleanupUser(did);
  });

  it("blocks a user by handle, publishing an app.bsky.graph.block record", async () => {
    const blocker = await loginNewUser(uniqueHandle("bella"));
    const blocked = await loginNewUser(uniqueHandle("cara"));

    const response = await blocker.app.inject({
      method: "POST",
      url: "/blocks",
      cookies: { ff_session: blocker.sessionId },
      headers: { "x-csrf-token": blocker.csrfToken },
      payload: { identifier: blocked.handle },
    });

    expect(response.statusCode).toBe(201);
    expect(blocker.publishCalls.some((c) => c.collection === "app.bsky.graph.block")).toBe(true);

    const listResponse = await blocker.app.inject({
      method: "GET",
      url: "/blocks",
      cookies: { ff_session: blocker.sessionId },
    });
    expect(listResponse.json()).toHaveLength(1);

    await blocker.app.close();
    await blocked.app.close();
    await cleanupUser(blocker.did);
    await cleanupUser(blocked.did);
  });

  it("404s when the identifier doesn't resolve to a user", async () => {
    const blocker = await loginNewUser(uniqueHandle("dax"));
    const response = await blocker.app.inject({
      method: "POST",
      url: "/blocks",
      cookies: { ff_session: blocker.sessionId },
      headers: { "x-csrf-token": blocker.csrfToken },
      payload: { identifier: "nobody-here.test" },
    });
    expect(response.statusCode).toBe(404);
    await blocker.app.close();
    await cleanupUser(blocker.did);
  });

  it("unblocking deletes the AT record and removes the block", async () => {
    const blocker = await loginNewUser(uniqueHandle("eve"));
    const blocked = await loginNewUser(uniqueHandle("finn"));

    await blocker.app.inject({
      method: "POST",
      url: "/blocks",
      cookies: { ff_session: blocker.sessionId },
      headers: { "x-csrf-token": blocker.csrfToken },
      payload: { identifier: blocked.handle },
    });

    const unblockResponse = await blocker.app.inject({
      method: "DELETE",
      url: `/blocks/${blocked.handle}`,
      cookies: { ff_session: blocker.sessionId },
      headers: { "x-csrf-token": blocker.csrfToken },
    });
    expect(unblockResponse.statusCode).toBe(204);
    expect(blocker.deleteCalls.some((c) => c.collection === "app.bsky.graph.block")).toBe(true);

    const listResponse = await blocker.app.inject({
      method: "GET",
      url: "/blocks",
      cookies: { ff_session: blocker.sessionId },
    });
    expect(listResponse.json()).toHaveLength(0);

    await blocker.app.close();
    await blocked.app.close();
    await cleanupUser(blocker.did);
    await cleanupUser(blocked.did);
  });

  it("hides a blocked user's comments from the blocker's view of a thread", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("gia"));
    const postId = await createPostFor(creator);
    const viewer = await loginNewUser(uniqueHandle("hank"));
    const rival = await loginNewUser(uniqueHandle("iris"));

    await rival.app.inject({
      method: "POST",
      url: `/posts/${postId}/comments`,
      cookies: { ff_session: rival.sessionId },
      headers: { "x-csrf-token": rival.csrfToken },
      payload: { text: "spammy comment" },
    });

    await viewer.app.inject({
      method: "POST",
      url: "/blocks",
      cookies: { ff_session: viewer.sessionId },
      headers: { "x-csrf-token": viewer.csrfToken },
      payload: { identifier: rival.handle },
    });

    const asViewer = await viewer.app.inject({
      method: "GET",
      url: `/posts/${postId}/comments`,
      cookies: { ff_session: viewer.sessionId },
    });
    expect((asViewer.json() as { comments: unknown[] }).comments).toHaveLength(0);

    const asAnon = await creator.app.inject({ method: "GET", url: `/posts/${postId}/comments` });
    expect((asAnon.json() as { comments: unknown[] }).comments).toHaveLength(1);

    await creator.app.close();
    await viewer.app.close();
    await rival.app.close();
    await cleanupUser(creator.did);
    await cleanupUser(viewer.did);
    await cleanupUser(rival.did);
  });
});
