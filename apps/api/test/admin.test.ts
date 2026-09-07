import { afterAll, describe, expect, it } from "vitest";
import {
  cleanupUser,
  createPostFor,
  loginAndBecomeCreator,
  loginNewUser,
  prisma,
  promoteToAdmin,
  redis,
  uniqueHandle,
} from "./helpers.js";

afterAll(async () => {
  await prisma.$disconnect();
  redis.disconnect();
});

async function fileReport(
  reporter: Awaited<ReturnType<typeof loginNewUser>>,
  subjectType: string,
  subjectId: string,
): Promise<string> {
  const response = await reporter.app.inject({
    method: "POST",
    url: "/reports",
    cookies: { ff_session: reporter.sessionId },
    headers: { "x-csrf-token": reporter.csrfToken },
    payload: { subjectType, subjectId, reasonType: "SPAM" },
  });
  return (response.json() as { moderationCaseId: string }).moderationCaseId;
}

describe("admin routes require role: ADMIN", () => {
  it("403s a logged-in non-admin", async () => {
    const { app, did, sessionId } = await loginNewUser(uniqueHandle("aaron"));
    const response = await app.inject({ method: "GET", url: "/admin/cases", cookies: { ff_session: sessionId } });
    expect(response.statusCode).toBe(403);
    await app.close();
    await cleanupUser(did);
  });

  it("401s an anonymous caller", async () => {
    const { app, did } = await loginNewUser(uniqueHandle("bella"));
    const response = await app.inject({ method: "GET", url: "/admin/cases" });
    expect(response.statusCode).toBe(401);
    await app.close();
    await cleanupUser(did);
  });
});

describe("GET /admin/cases[/:id]", () => {
  it("lists an open case with its reports", async () => {
    const admin = await loginNewUser(uniqueHandle("cara"));
    await promoteToAdmin(admin.did);
    const creator = await loginAndBecomeCreator(uniqueHandle("dax"));
    const postId = await createPostFor(creator);
    const reporter = await loginNewUser(uniqueHandle("eve"));
    const caseId = await fileReport(reporter, "POST", postId);

    const listResponse = await admin.app.inject({
      method: "GET",
      url: "/admin/cases?status=OPEN",
      cookies: { ff_session: admin.sessionId },
    });
    expect(listResponse.json()).toEqual(expect.arrayContaining([expect.objectContaining({ id: caseId })]));

    const detailResponse = await admin.app.inject({
      method: "GET",
      url: `/admin/cases/${caseId}`,
      cookies: { ff_session: admin.sessionId },
    });
    const detail = detailResponse.json() as { reports: unknown[] };
    expect(detail.reports).toHaveLength(1);

    await admin.app.close();
    await creator.app.close();
    await reporter.app.close();
    await cleanupUser(admin.did);
    await cleanupUser(creator.did);
    await cleanupUser(reporter.did);
  });
});

describe("POST /admin/cases/:id/dismiss", () => {
  it("dismisses a case and writes an audit log", async () => {
    const admin = await loginNewUser(uniqueHandle("finn"));
    await promoteToAdmin(admin.did);
    const creator = await loginAndBecomeCreator(uniqueHandle("gia"));
    const postId = await createPostFor(creator);
    const reporter = await loginNewUser(uniqueHandle("hank"));
    const caseId = await fileReport(reporter, "POST", postId);

    const response = await admin.app.inject({
      method: "POST",
      url: `/admin/cases/${caseId}/dismiss`,
      cookies: { ff_session: admin.sessionId },
      headers: { "x-csrf-token": admin.csrfToken },
      payload: { note: "not spam actually" },
    });
    expect(response.json()).toMatchObject({ status: "DISMISSED" });

    const auditResponse = await admin.app.inject({
      method: "GET",
      url: `/admin/audit-log?targetType=POST&targetId=${postId}`,
      cookies: { ff_session: admin.sessionId },
    });
    expect(auditResponse.json()).toEqual(expect.arrayContaining([expect.objectContaining({ action: "CASE_DISMISSED" })]));

    await admin.app.close();
    await creator.app.close();
    await reporter.app.close();
    await cleanupUser(admin.did);
    await cleanupUser(creator.did);
    await cleanupUser(reporter.did);
  });
});

describe("POST /admin/posts/:id/remove", () => {
  it("soft-removes a reported post", async () => {
    const admin = await loginNewUser(uniqueHandle("iris"));
    await promoteToAdmin(admin.did);
    const creator = await loginAndBecomeCreator(uniqueHandle("jace"));
    const postId = await createPostFor(creator);
    const reporter = await loginNewUser(uniqueHandle("kira"));
    const caseId = await fileReport(reporter, "POST", postId);

    const response = await admin.app.inject({
      method: "POST",
      url: `/admin/posts/${postId}/remove`,
      cookies: { ff_session: admin.sessionId },
      headers: { "x-csrf-token": admin.csrfToken },
      payload: { caseId },
    });
    expect(response.statusCode).toBe(204);

    const post = await prisma.post.findUniqueOrThrow({ where: { id: postId } });
    expect(post.deletedAt).not.toBeNull();

    const getResponse = await creator.app.inject({ method: "GET", url: `/posts/${postId}` });
    expect(getResponse.statusCode).toBe(404);

    await admin.app.close();
    await creator.app.close();
    await reporter.app.close();
    await cleanupUser(admin.did);
    await cleanupUser(creator.did);
    await cleanupUser(reporter.did);
  });
});

describe("POST /admin/users/:id/restrict", () => {
  it("blocks the target from commenting, liking, subscribing, reporting, and blocking, but not from reading", async () => {
    const admin = await loginNewUser(uniqueHandle("liam"));
    await promoteToAdmin(admin.did);
    const creator = await loginAndBecomeCreator(uniqueHandle("mira"));
    const postId = await createPostFor(creator);
    const target = await loginNewUser(uniqueHandle("nash"));
    const targetRow = await prisma.user.findUniqueOrThrow({ where: { did: target.did } });

    const restrictResponse = await admin.app.inject({
      method: "POST",
      url: `/admin/users/${targetRow.id}/restrict`,
      cookies: { ff_session: admin.sessionId },
      headers: { "x-csrf-token": admin.csrfToken },
      payload: {},
    });
    expect(restrictResponse.statusCode).toBe(204);

    const commentAttempt = await target.app.inject({
      method: "POST",
      url: `/posts/${postId}/comments`,
      cookies: { ff_session: target.sessionId },
      headers: { "x-csrf-token": target.csrfToken },
      payload: { text: "hi" },
    });
    expect(commentAttempt.statusCode).toBe(403);

    const likeAttempt = await target.app.inject({
      method: "POST",
      url: `/posts/${postId}/likes`,
      cookies: { ff_session: target.sessionId },
      headers: { "x-csrf-token": target.csrfToken },
    });
    expect(likeAttempt.statusCode).toBe(403);

    const reportAttempt = await target.app.inject({
      method: "POST",
      url: "/reports",
      cookies: { ff_session: target.sessionId },
      headers: { "x-csrf-token": target.csrfToken },
      payload: { subjectType: "POST", subjectId: postId, reasonType: "SPAM" },
    });
    expect(reportAttempt.statusCode).toBe(403);

    const readAttempt = await target.app.inject({ method: "GET", url: `/posts/${postId}` });
    expect(readAttempt.statusCode).toBe(200);

    const reinstateResponse = await admin.app.inject({
      method: "POST",
      url: `/admin/users/${targetRow.id}/reinstate`,
      cookies: { ff_session: admin.sessionId },
      headers: { "x-csrf-token": admin.csrfToken },
    });
    expect(reinstateResponse.statusCode).toBe(204);

    const afterReinstate = await target.app.inject({
      method: "POST",
      url: `/posts/${postId}/likes`,
      cookies: { ff_session: target.sessionId },
      headers: { "x-csrf-token": target.csrfToken },
    });
    expect(afterReinstate.statusCode).toBe(200);

    await admin.app.close();
    await creator.app.close();
    await target.app.close();
    await cleanupUser(admin.did);
    await cleanupUser(creator.did);
    await cleanupUser(target.did);
  });
});

describe("POST /admin/creators/:id/suspend and /reinstate", () => {
  it("suspends a creator (invisible via resolveCreatorByIdentifier) then reinstates them", async () => {
    const admin = await loginNewUser(uniqueHandle("opal"));
    await promoteToAdmin(admin.did);
    const creator = await loginAndBecomeCreator(uniqueHandle("percy"));
    const creatorRow = await prisma.creator.findUniqueOrThrow({ where: { did: creator.did } });

    const suspendResponse = await admin.app.inject({
      method: "POST",
      url: `/admin/creators/${creatorRow.id}/suspend`,
      cookies: { ff_session: admin.sessionId },
      headers: { "x-csrf-token": admin.csrfToken },
      payload: {},
    });
    expect(suspendResponse.json()).toEqual({ status: "SUSPENDED" });

    const profileResponse = await admin.app.inject({ method: "GET", url: `/creators/${creator.handle}` });
    expect(profileResponse.statusCode).toBe(404);

    const reinstateResponse = await admin.app.inject({
      method: "POST",
      url: `/admin/creators/${creatorRow.id}/reinstate`,
      cookies: { ff_session: admin.sessionId },
      headers: { "x-csrf-token": admin.csrfToken },
    });
    expect(reinstateResponse.json()).toEqual({ status: "ACTIVE" });

    await admin.app.close();
    await creator.app.close();
    await cleanupUser(admin.did);
    await cleanupUser(creator.did);
  });
});

describe("POST /admin/cases/:id/labels", () => {
  it("applies and removes a moderation label on the case's subject", async () => {
    const admin = await loginNewUser(uniqueHandle("quinn"));
    await promoteToAdmin(admin.did);
    const creator = await loginAndBecomeCreator(uniqueHandle("rio"));
    const postId = await createPostFor(creator);
    const reporter = await loginNewUser(uniqueHandle("sage"));
    const caseId = await fileReport(reporter, "POST", postId);

    const applyResponse = await admin.app.inject({
      method: "POST",
      url: `/admin/cases/${caseId}/labels`,
      cookies: { ff_session: admin.sessionId },
      headers: { "x-csrf-token": admin.csrfToken },
      payload: { val: "spam" },
    });
    expect(applyResponse.statusCode).toBe(201);

    const labels = await prisma.contentLabel.findMany({ where: { subjectType: "POST", subjectId: postId } });
    expect(labels).toHaveLength(1);

    const removeResponse = await admin.app.inject({
      method: "DELETE",
      url: `/admin/cases/${caseId}/labels/spam`,
      cookies: { ff_session: admin.sessionId },
      headers: { "x-csrf-token": admin.csrfToken },
    });
    expect(removeResponse.statusCode).toBe(204);

    const labelsAfter = await prisma.contentLabel.findMany({ where: { subjectType: "POST", subjectId: postId } });
    expect(labelsAfter).toHaveLength(2);
    expect(labelsAfter.some((l) => l.neg)).toBe(true);

    await admin.app.close();
    await creator.app.close();
    await reporter.app.close();
    await cleanupUser(admin.did);
    await cleanupUser(creator.did);
    await cleanupUser(reporter.did);
  });
});
