import { afterAll, describe, expect, it } from "vitest";
import { cleanupUser, createPostFor, createTierFor, loginAndBecomeCreator, loginNewUser, prisma, redis, uniqueHandle } from "./helpers.js";

afterAll(async () => {
  await prisma.$disconnect();
  redis.disconnect();
});

describe("POST /creators/me/blocks", () => {
  it("requires being a creator", async () => {
    const { app, did, sessionId, csrfToken } = await loginNewUser(uniqueHandle("aaron"));
    const response = await app.inject({
      method: "POST",
      url: "/creators/me/blocks",
      cookies: { ff_session: sessionId },
      headers: { "x-csrf-token": csrfToken },
      payload: { identifier: "someone.test" },
    });
    expect(response.statusCode).toBe(404);
    await app.close();
    await cleanupUser(did);
  });

  it("blocks a user from the creator's content, with no AT record involved", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("bella"));
    const target = await loginNewUser(uniqueHandle("cara"));
    creator.publishCalls.length = 0;

    const response = await creator.app.inject({
      method: "POST",
      url: "/creators/me/blocks",
      cookies: { ff_session: creator.sessionId },
      headers: { "x-csrf-token": creator.csrfToken },
      payload: { identifier: target.handle, reason: "harassment" },
    });
    expect(response.statusCode).toBe(201);
    expect(creator.publishCalls).toHaveLength(0);

    const listResponse = await creator.app.inject({
      method: "GET",
      url: "/creators/me/blocks",
      cookies: { ff_session: creator.sessionId },
    });
    expect(listResponse.json()).toHaveLength(1);

    await creator.app.close();
    await target.app.close();
    await cleanupUser(creator.did);
    await cleanupUser(target.did);
  });

  it("prevents a blocked user from commenting on the creator's posts", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("dax"));
    const postId = await createPostFor(creator);
    const target = await loginNewUser(uniqueHandle("eve"));

    await creator.app.inject({
      method: "POST",
      url: "/creators/me/blocks",
      cookies: { ff_session: creator.sessionId },
      headers: { "x-csrf-token": creator.csrfToken },
      payload: { identifier: target.handle },
    });

    const response = await target.app.inject({
      method: "POST",
      url: `/posts/${postId}/comments`,
      cookies: { ff_session: target.sessionId },
      headers: { "x-csrf-token": target.csrfToken },
      payload: { text: "let me in" },
    });
    expect(response.statusCode).toBe(403);

    await creator.app.close();
    await target.app.close();
    await cleanupUser(creator.did);
    await cleanupUser(target.did);
  });

  it("prevents a blocked user from subscribing, and unblocking allows it again", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("finn"));
    const tierId = await createTierFor(creator);
    const target = await loginNewUser(uniqueHandle("gia"));

    await creator.app.inject({
      method: "POST",
      url: "/creators/me/blocks",
      cookies: { ff_session: creator.sessionId },
      headers: { "x-csrf-token": creator.csrfToken },
      payload: { identifier: target.handle },
    });

    const blockedAttempt = await target.app.inject({
      method: "POST",
      url: `/creators/${creator.handle}/subscribe`,
      cookies: { ff_session: target.sessionId },
      headers: { "x-csrf-token": target.csrfToken },
      payload: { tierId },
    });
    expect(blockedAttempt.statusCode).toBe(403);

    await creator.app.inject({
      method: "DELETE",
      url: `/creators/me/blocks/${target.handle}`,
      cookies: { ff_session: creator.sessionId },
      headers: { "x-csrf-token": creator.csrfToken },
    });

    const secondAttempt = await target.app.inject({
      method: "POST",
      url: `/creators/${creator.handle}/subscribe`,
      cookies: { ff_session: target.sessionId },
      headers: { "x-csrf-token": target.csrfToken },
      payload: { tierId },
    });
    expect(secondAttempt.statusCode).toBe(201);

    await creator.app.close();
    await target.app.close();
    await cleanupUser(creator.did);
    await cleanupUser(target.did);
  });
});
