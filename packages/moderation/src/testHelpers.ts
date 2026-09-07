import { randomUUID } from "node:crypto";
import type { Comment, Creator, PrismaClient, Post, User } from "@foryour-fans/database";

/** Test-only fixture helpers, mirroring packages/subscriptions/src/keyGrants.test.ts's setup style. Not exported from index.ts. */

export function newDid(): string {
  return `did:plc:test${randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

export function uniqueHandle(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 8)}.test`;
}

export async function createUser(prisma: PrismaClient, overrides: Partial<{ did: string; role: "USER" | "ADMIN" }> = {}): Promise<User> {
  return prisma.user.create({
    data: { did: overrides.did ?? newDid(), handle: uniqueHandle("user"), role: overrides.role },
  });
}

export async function createCreator(prisma: PrismaClient): Promise<{ creator: Creator; user: User }> {
  const did = newDid();
  const user = await prisma.user.create({ data: { did, handle: uniqueHandle("creator") } });
  const creator = await prisma.creator.create({ data: { userId: user.id, did } });
  return { creator, user };
}

export async function createPost(prisma: PrismaClient, creatorId: string): Promise<Post> {
  return prisma.post.create({ data: { creatorId, visibility: "PUBLIC", text: "hello world" } });
}

export async function createComment(prisma: PrismaClient, postId: string, authorUserId: string): Promise<Comment> {
  return prisma.comment.create({ data: { postId, authorUserId, text: "nice post" } });
}

export async function cleanupModerationFixtures(prisma: PrismaClient, dids: string[]): Promise<void> {
  const users = await prisma.user.findMany({ where: { did: { in: dids } } });
  const creators = await prisma.creator.findMany({ where: { did: { in: dids } } });
  const userIds = users.map((u) => u.id);
  const creatorIds = creators.map((c) => c.id);

  await prisma.auditLog.deleteMany({ where: { OR: [{ actorUserId: { in: userIds } }, { targetId: { in: [...userIds, ...creatorIds] } }] } });
  await prisma.report.deleteMany({ where: { OR: [{ reporterUserId: { in: userIds } }, { subjectId: { in: [...userIds, ...creatorIds] } }] } });
  await prisma.contentLabel.deleteMany({ where: { OR: [{ appliedByUserId: { in: userIds } }, { subjectId: { in: [...userIds, ...creatorIds] } }] } });
  await prisma.moderationCase.deleteMany({ where: { subjectId: { in: [...userIds, ...creatorIds] } } });
  await prisma.userBlock.deleteMany({ where: { OR: [{ blockerUserId: { in: userIds } }, { blockedUserId: { in: userIds } }] } });
  await prisma.creatorBlock.deleteMany({ where: { OR: [{ creatorId: { in: creatorIds } }, { blockedUserId: { in: userIds } }] } });
  await prisma.comment.deleteMany({ where: { OR: [{ authorUserId: { in: userIds } }, { post: { creatorId: { in: creatorIds } } }] } });
  await prisma.post.deleteMany({ where: { creatorId: { in: creatorIds } } });
  await prisma.creator.deleteMany({ where: { id: { in: creatorIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}
