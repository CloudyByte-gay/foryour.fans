import { getPrismaClient, type PrismaClient } from "@foryour-fans/database";
import { afterAll, describe, expect, it } from "vitest";
import { assertCaseOpen, dismissCase, findOrOpenCase, getCaseWithDetails, ModerationCaseAlreadyResolvedError } from "./cases.js";
import { PassthroughContentClassifier } from "./classifiers/types.js";
import { createReport } from "./reports.js";
import { cleanupModerationFixtures, createCreator, createPost, createUser } from "./testHelpers.js";

const prisma: PrismaClient = getPrismaClient();
const classifier = new PassthroughContentClassifier();
const dids: string[] = [];

afterAll(async () => {
  await cleanupModerationFixtures(prisma, dids);
  await prisma.$disconnect();
});

describe("findOrOpenCase", () => {
  it("reuses an existing OPEN case for the same subject", async () => {
    const { creator, user } = await createCreator(prisma);
    dids.push(user.did);
    const post = await createPost(prisma, creator.id);

    const first = await findOrOpenCase(prisma, "POST", post.id);
    const second = await findOrOpenCase(prisma, "POST", post.id);
    expect(second.id).toBe(first.id);
  });

  it("opens a new case for a subject whose only prior case was resolved", async () => {
    const admin = await createUser(prisma, { role: "ADMIN" });
    const { creator, user } = await createCreator(prisma);
    dids.push(admin.did, user.did);
    const post = await createPost(prisma, creator.id);

    const first = await findOrOpenCase(prisma, "POST", post.id);
    await dismissCase(prisma, admin, first.id);

    const second = await findOrOpenCase(prisma, "POST", post.id);
    expect(second.id).not.toBe(first.id);
    expect(second.status).toBe("OPEN");
  });
});

describe("assertCaseOpen", () => {
  it("throws for a non-OPEN case", async () => {
    const admin = await createUser(prisma, { role: "ADMIN" });
    const { creator, user } = await createCreator(prisma);
    dids.push(admin.did, user.did);
    const post = await createPost(prisma, creator.id);
    const opened = await findOrOpenCase(prisma, "POST", post.id);
    const dismissed = await dismissCase(prisma, admin, opened.id);

    expect(() => assertCaseOpen(dismissed)).toThrow(ModerationCaseAlreadyResolvedError);
  });
});

describe("dismissCase", () => {
  it("marks the case DISMISSED and writes an audit log", async () => {
    const admin = await createUser(prisma, { role: "ADMIN" });
    const { creator, user } = await createCreator(prisma);
    dids.push(admin.did, user.did);
    const post = await createPost(prisma, creator.id);
    const opened = await findOrOpenCase(prisma, "POST", post.id);

    const dismissed = await dismissCase(prisma, admin, opened.id, "not actually spam");
    expect(dismissed.status).toBe("DISMISSED");
    expect(dismissed.resolvedByUserId).toBe(admin.id);
    expect(dismissed.resolutionNote).toBe("not actually spam");

    const logs = await prisma.auditLog.findMany({ where: { moderationCaseId: opened.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ action: "CASE_DISMISSED", actorUserId: admin.id, actorRole: "ADMIN" });
  });

  it("rejects dismissing an already-resolved case", async () => {
    const admin = await createUser(prisma, { role: "ADMIN" });
    const { creator, user } = await createCreator(prisma);
    dids.push(admin.did, user.did);
    const post = await createPost(prisma, creator.id);
    const opened = await findOrOpenCase(prisma, "POST", post.id);
    await dismissCase(prisma, admin, opened.id);

    await expect(dismissCase(prisma, admin, opened.id)).rejects.toThrow(ModerationCaseAlreadyResolvedError);
  });
});

describe("getCaseWithDetails", () => {
  it("includes linked reports and audit logs", async () => {
    const reporter = await createUser(prisma);
    const admin = await createUser(prisma, { role: "ADMIN" });
    const { creator, user } = await createCreator(prisma);
    dids.push(reporter.did, admin.did, user.did);
    const post = await createPost(prisma, creator.id);

    const report = await createReport(prisma, classifier, {
      reporterUserId: reporter.id,
      subjectType: "POST",
      subjectId: post.id,
      reasonType: "SPAM",
    });
    await dismissCase(prisma, admin, report.moderationCaseId);

    const details = await getCaseWithDetails(prisma, report.moderationCaseId);
    expect(details.reports).toHaveLength(1);
    expect(details.auditLogs).toHaveLength(1);
  });
});
