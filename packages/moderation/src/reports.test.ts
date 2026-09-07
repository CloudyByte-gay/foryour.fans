import { getPrismaClient, type PrismaClient } from "@foryour-fans/database";
import { afterAll, describe, expect, it } from "vitest";
import { PassthroughContentClassifier } from "./classifiers/types.js";
import { createReport, reasonRequiresLegalReview, ReportSubjectNotFoundError, ReportValidationError } from "./reports.js";
import { cleanupModerationFixtures, createComment, createCreator, createPost, createUser } from "./testHelpers.js";

const prisma: PrismaClient = getPrismaClient();
const classifier = new PassthroughContentClassifier();
const dids: string[] = [];

afterAll(async () => {
  await cleanupModerationFixtures(prisma, dids);
  await prisma.$disconnect();
});

describe("reasonRequiresLegalReview", () => {
  it("flags NCII and ILLEGAL_CONTENT", () => {
    expect(reasonRequiresLegalReview("NCII")).toBe(true);
    expect(reasonRequiresLegalReview("ILLEGAL_CONTENT")).toBe(true);
  });
  it("does not flag ordinary categories", () => {
    expect(reasonRequiresLegalReview("SPAM")).toBe(false);
    expect(reasonRequiresLegalReview("HARASSMENT")).toBe(false);
  });
});

describe("createReport", () => {
  it("opens a new moderation case for a first report", async () => {
    const reporter = await createUser(prisma);
    const { creator, user } = await createCreator(prisma);
    dids.push(reporter.did, user.did);
    const post = await createPost(prisma, creator.id);

    const report = await createReport(prisma, classifier, {
      reporterUserId: reporter.id,
      subjectType: "POST",
      subjectId: post.id,
      reasonType: "SPAM",
    });

    const moderationCase = await prisma.moderationCase.findUnique({ where: { id: report.moderationCaseId } });
    expect(moderationCase).toMatchObject({ subjectType: "POST", subjectId: post.id, status: "OPEN", requiresLegalReview: false });
  });

  it("accumulates a second report about the same subject onto the same open case", async () => {
    const reporterA = await createUser(prisma);
    const reporterB = await createUser(prisma);
    const { creator, user } = await createCreator(prisma);
    dids.push(reporterA.did, reporterB.did, user.did);
    const post = await createPost(prisma, creator.id);

    const first = await createReport(prisma, classifier, {
      reporterUserId: reporterA.id,
      subjectType: "POST",
      subjectId: post.id,
      reasonType: "SPAM",
    });
    const second = await createReport(prisma, classifier, {
      reporterUserId: reporterB.id,
      subjectType: "POST",
      subjectId: post.id,
      reasonType: "HARASSMENT",
    });

    expect(second.moderationCaseId).toBe(first.moderationCaseId);
    const reports = await prisma.report.findMany({ where: { moderationCaseId: first.moderationCaseId } });
    expect(reports).toHaveLength(2);
  });

  it("flags the case for legal review when the reason is NCII", async () => {
    const reporter = await createUser(prisma);
    const { creator, user } = await createCreator(prisma);
    dids.push(reporter.did, user.did);
    const post = await createPost(prisma, creator.id);

    const report = await createReport(prisma, classifier, {
      reporterUserId: reporter.id,
      subjectType: "POST",
      subjectId: post.id,
      reasonType: "NCII",
      reason: "unauthorized intimate media",
    });

    const moderationCase = await prisma.moderationCase.findUnique({ where: { id: report.moderationCaseId } });
    expect(moderationCase?.requiresLegalReview).toBe(true);
  });

  it("rejects a report about a comment that doesn't exist", async () => {
    const reporter = await createUser(prisma);
    dids.push(reporter.did);
    await expect(
      createReport(prisma, classifier, {
        reporterUserId: reporter.id,
        subjectType: "COMMENT",
        subjectId: "00000000-0000-0000-0000-000000000000",
        reasonType: "SPAM",
      }),
    ).rejects.toThrow(ReportSubjectNotFoundError);
  });

  it("rejects a report about a deleted post", async () => {
    const reporter = await createUser(prisma);
    const { creator, user } = await createCreator(prisma);
    dids.push(reporter.did, user.did);
    const post = await createPost(prisma, creator.id);
    await prisma.post.update({ where: { id: post.id }, data: { deletedAt: new Date() } });

    await expect(
      createReport(prisma, classifier, { reporterUserId: reporter.id, subjectType: "POST", subjectId: post.id, reasonType: "SPAM" }),
    ).rejects.toThrow(ReportSubjectNotFoundError);
  });

  it("reports a comment successfully", async () => {
    const reporter = await createUser(prisma);
    const { creator, user } = await createCreator(prisma);
    dids.push(reporter.did, user.did);
    const post = await createPost(prisma, creator.id);
    const comment = await createComment(prisma, post.id, user.id);

    const report = await createReport(prisma, classifier, {
      reporterUserId: reporter.id,
      subjectType: "COMMENT",
      subjectId: comment.id,
      reasonType: "HARASSMENT",
    });
    expect(report.subjectType).toBe("COMMENT");
  });

  it("rejects an overlong reason", async () => {
    const reporter = await createUser(prisma);
    const { creator, user } = await createCreator(prisma);
    dids.push(reporter.did, user.did);
    const post = await createPost(prisma, creator.id);

    await expect(
      createReport(prisma, classifier, {
        reporterUserId: reporter.id,
        subjectType: "POST",
        subjectId: post.id,
        reasonType: "OTHER",
        reason: "x".repeat(20_001),
      }),
    ).rejects.toThrow(ReportValidationError);
  });
});
