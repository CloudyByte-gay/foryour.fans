import { getPrismaClient, type PrismaClient } from "@foryour-fans/database";
import { afterAll, describe, expect, it } from "vitest";
import { listModerationNotices } from "./moderationNotices.js";
import { removeContent } from "./moderationActions.js";
import { cleanupModerationFixtures, createComment, createCreator, createPost, createUser } from "./testHelpers.js";

const prisma: PrismaClient = getPrismaClient();
const dids: string[] = [];

afterAll(async () => {
  await cleanupModerationFixtures(prisma, dids);
  await prisma.$disconnect();
});

describe("listModerationNotices", () => {
  it("returns nothing for a caller with no removed content", async () => {
    const { user } = await createCreator(prisma);
    dids.push(user.did);
    expect(await listModerationNotices(prisma, user.did)).toEqual([]);
  });

  it("returns nothing for an unknown did", async () => {
    expect(await listModerationNotices(prisma, "did:plc:doesnotexist")).toEqual([]);
  });

  it("surfaces a moderator-removed post owned by the caller, with its reason", async () => {
    const admin = await createUser(prisma, { role: "ADMIN" });
    const { creator, user } = await createCreator(prisma);
    dids.push(admin.did, user.did);
    const post = await createPost(prisma, creator.id);

    await removeContent(prisma, { admin, targetType: "POST", targetId: post.id, reason: "spam" });

    const notices = await listModerationNotices(prisma, user.did);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ targetType: "POST", targetId: post.id, reason: "spam" });
  });

  it("surfaces a moderator-removed comment owned by the caller", async () => {
    const admin = await createUser(prisma, { role: "ADMIN" });
    const { creator, user: postAuthor } = await createCreator(prisma);
    const commenter = await createUser(prisma);
    dids.push(admin.did, postAuthor.did, commenter.did);
    const post = await createPost(prisma, creator.id);
    const comment = await createComment(prisma, post.id, commenter.id);

    await removeContent(prisma, { admin, targetType: "COMMENT", targetId: comment.id });

    const notices = await listModerationNotices(prisma, commenter.did);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ targetType: "COMMENT", targetId: comment.id, reason: null });
  });

  it("never surfaces the caller's own self-deleted post — only ones a moderator removed", async () => {
    const { creator, user } = await createCreator(prisma);
    dids.push(user.did);
    const post = await createPost(prisma, creator.id);
    // Same soft-delete a self-initiated delete would perform — no
    // CONTENT_REMOVED audit entry, since only removeContent writes one.
    await prisma.post.update({ where: { id: post.id }, data: { deletedAt: new Date() } });

    expect(await listModerationNotices(prisma, user.did)).toEqual([]);
  });

  it("never surfaces another creator's removed post", async () => {
    const admin = await createUser(prisma, { role: "ADMIN" });
    const { creator: otherCreator, user: otherUser } = await createCreator(prisma);
    const { user: viewer } = await createCreator(prisma);
    dids.push(admin.did, otherUser.did, viewer.did);
    const post = await createPost(prisma, otherCreator.id);
    await removeContent(prisma, { admin, targetType: "POST", targetId: post.id });

    expect(await listModerationNotices(prisma, viewer.did)).toEqual([]);
  });
});
