import { getPrismaClient, type PrismaClient } from "@foryour-fans/database";
import { afterAll, describe, expect, it } from "vitest";
import { findOrOpenCase } from "./cases.js";
import { ModerationActionError, reinstateAccount, reinstateCreator, removeContent, restrictAccount, suspendCreator } from "./moderationActions.js";
import { cleanupModerationFixtures, createComment, createCreator, createPost, createUser } from "./testHelpers.js";

const prisma: PrismaClient = getPrismaClient();
const dids: string[] = [];

afterAll(async () => {
  await cleanupModerationFixtures(prisma, dids);
  await prisma.$disconnect();
});

describe("removeContent", () => {
  it("soft-deletes a post and marks the linked case ACTION_TAKEN", async () => {
    const admin = await createUser(prisma, { role: "ADMIN" });
    const { creator, user } = await createCreator(prisma);
    dids.push(admin.did, user.did);
    const post = await createPost(prisma, creator.id);
    const openCase = await findOrOpenCase(prisma, "POST", post.id);

    await removeContent(prisma, { admin, targetType: "POST", targetId: post.id, caseId: openCase.id });

    const updatedPost = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
    expect(updatedPost.deletedAt).not.toBeNull();
    const updatedCase = await prisma.moderationCase.findUniqueOrThrow({ where: { id: openCase.id } });
    expect(updatedCase.status).toBe("ACTION_TAKEN");
    expect(updatedCase.resolvedByUserId).toBe(admin.id);

    const logs = await prisma.auditLog.findMany({ where: { moderationCaseId: openCase.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ action: "CONTENT_REMOVED", targetType: "POST", targetId: post.id });
  });

  it("soft-deletes a comment", async () => {
    const admin = await createUser(prisma, { role: "ADMIN" });
    const { creator, user } = await createCreator(prisma);
    dids.push(admin.did, user.did);
    const post = await createPost(prisma, creator.id);
    const comment = await createComment(prisma, post.id, user.id);

    await removeContent(prisma, { admin, targetType: "COMMENT", targetId: comment.id });

    const updated = await prisma.comment.findUniqueOrThrow({ where: { id: comment.id } });
    expect(updated.deletedAt).not.toBeNull();
  });

  it("rejects removing an already-removed post", async () => {
    const admin = await createUser(prisma, { role: "ADMIN" });
    const { creator, user } = await createCreator(prisma);
    dids.push(admin.did, user.did);
    const post = await createPost(prisma, creator.id);
    await removeContent(prisma, { admin, targetType: "POST", targetId: post.id });

    await expect(removeContent(prisma, { admin, targetType: "POST", targetId: post.id })).rejects.toThrow(ModerationActionError);
  });
});

describe("restrictAccount / reinstateAccount", () => {
  it("restricts and reinstates a user, logging both", async () => {
    const admin = await createUser(prisma, { role: "ADMIN" });
    const target = await createUser(prisma);
    dids.push(admin.did, target.did);

    await restrictAccount(prisma, { admin, userId: target.id });
    let updated = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
    expect(updated.status).toBe("RESTRICTED");

    await reinstateAccount(prisma, admin, target.id);
    updated = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
    expect(updated.status).toBe("ACTIVE");

    const logs = await prisma.auditLog.findMany({ where: { targetType: "USER", targetId: target.id }, orderBy: { createdAt: "asc" } });
    expect(logs.map((l) => l.action)).toEqual(["ACCOUNT_RESTRICTED", "ACCOUNT_REINSTATED"]);
  });
});

describe("suspendCreator / reinstateCreator", () => {
  it("suspends and reinstates a creator", async () => {
    const admin = await createUser(prisma, { role: "ADMIN" });
    const { creator, user } = await createCreator(prisma);
    dids.push(admin.did, user.did);

    const suspended = await suspendCreator(prisma, { admin, creatorId: creator.id });
    expect(suspended.status).toBe("SUSPENDED");

    const reinstated = await reinstateCreator(prisma, admin, creator.id);
    expect(reinstated.status).toBe("ACTIVE");
  });
});
