import { afterAll, describe, expect, it } from "vitest";
import { cleanupUser, createPostFor, loginAndBecomeCreator, loginNewUser, uniqueHandle } from "./helpers.js";
import { prisma, redis } from "./helpers.js";

afterAll(async () => {
  await prisma.$disconnect();
  redis.disconnect();
});

describe("POST /reports", () => {
  it("requires authentication", async () => {
    const { app, did } = await loginNewUser(uniqueHandle("aaron"));
    const response = await app.inject({
      method: "POST",
      url: "/reports",
      payload: { subjectType: "POST", subjectId: "00000000-0000-0000-0000-000000000000", reasonType: "SPAM" },
    });
    expect(response.statusCode).toBe(401);
    await app.close();
    await cleanupUser(did);
  });

  it("files a report against a post and opens a moderation case", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("bella"));
    const postId = await createPostFor(creator);
    const reporter = await loginNewUser(uniqueHandle("cara"));

    const response = await reporter.app.inject({
      method: "POST",
      url: "/reports",
      cookies: { ff_session: reporter.sessionId },
      headers: { "x-csrf-token": reporter.csrfToken },
      payload: { subjectType: "POST", subjectId: postId, reasonType: "SPAM", reason: "buy my crypto course" },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json() as { id: string; moderationCaseId: string };
    expect(body.moderationCaseId).toBeTruthy();

    const moderationCase = await prisma.moderationCase.findUnique({ where: { id: body.moderationCaseId } });
    expect(moderationCase).toMatchObject({ status: "OPEN", subjectType: "POST", subjectId: postId });

    await reporter.app.close();
    await creator.app.close();
    await cleanupUser(reporter.did);
    await cleanupUser(creator.did);
  });

  it("flags legal review for an NCII report", async () => {
    const creator = await loginAndBecomeCreator(uniqueHandle("dax"));
    const postId = await createPostFor(creator);
    const reporter = await loginNewUser(uniqueHandle("eve"));

    const response = await reporter.app.inject({
      method: "POST",
      url: "/reports",
      cookies: { ff_session: reporter.sessionId },
      headers: { "x-csrf-token": reporter.csrfToken },
      payload: { subjectType: "POST", subjectId: postId, reasonType: "NCII" },
    });
    const { moderationCaseId } = response.json() as { moderationCaseId: string };
    const moderationCase = await prisma.moderationCase.findUniqueOrThrow({ where: { id: moderationCaseId } });
    expect(moderationCase.requiresLegalReview).toBe(true);

    await reporter.app.close();
    await creator.app.close();
    await cleanupUser(reporter.did);
    await cleanupUser(creator.did);
  });

  it("404s for a subject that doesn't exist", async () => {
    const reporter = await loginNewUser(uniqueHandle("finn"));
    const response = await reporter.app.inject({
      method: "POST",
      url: "/reports",
      cookies: { ff_session: reporter.sessionId },
      headers: { "x-csrf-token": reporter.csrfToken },
      payload: { subjectType: "POST", subjectId: "00000000-0000-0000-0000-000000000000", reasonType: "SPAM" },
    });
    expect(response.statusCode).toBe(404);
    await reporter.app.close();
    await cleanupUser(reporter.did);
  });

  it("rejects an invalid reasonType", async () => {
    const reporter = await loginNewUser(uniqueHandle("gia"));
    const response = await reporter.app.inject({
      method: "POST",
      url: "/reports",
      cookies: { ff_session: reporter.sessionId },
      headers: { "x-csrf-token": reporter.csrfToken },
      payload: { subjectType: "POST", subjectId: "00000000-0000-0000-0000-000000000000", reasonType: "NOT_A_REASON" },
    });
    expect(response.statusCode).toBe(400);
    await reporter.app.close();
    await cleanupUser(reporter.did);
  });
});
