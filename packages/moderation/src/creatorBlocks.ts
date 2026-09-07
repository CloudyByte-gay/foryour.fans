import type { Creator, CreatorBlock, PrismaClient } from "@foryour-fans/database";

/**
 * A creator-specific ban from that creator's own content/comments — no AT
 * Protocol equivalent, so Postgres-only (see CreatorBlock's doc comment in
 * schema.prisma). Idempotent: blocking an already-blocked user is a no-op
 * that returns the existing row.
 */
export async function blockUserFromCreator(
  prisma: PrismaClient,
  creator: Creator,
  blockedUserId: string,
  reason?: string,
): Promise<CreatorBlock> {
  const existing = await prisma.creatorBlock.findUnique({
    where: { creatorId_blockedUserId: { creatorId: creator.id, blockedUserId } },
  });
  if (existing) {
    return existing;
  }

  return prisma.creatorBlock.create({ data: { creatorId: creator.id, blockedUserId, reason } });
}

export async function unblockUserFromCreator(prisma: PrismaClient, creatorId: string, blockedUserId: string): Promise<void> {
  await prisma.creatorBlock.deleteMany({ where: { creatorId, blockedUserId } });
}

export async function isBlockedByCreator(prisma: PrismaClient, creatorId: string, userId: string): Promise<boolean> {
  const row = await prisma.creatorBlock.findUnique({
    where: { creatorId_blockedUserId: { creatorId, blockedUserId: userId } },
    select: { id: true },
  });
  return row !== null;
}

export async function listCreatorBlocks(prisma: PrismaClient, creatorId: string): Promise<CreatorBlock[]> {
  return prisma.creatorBlock.findMany({ where: { creatorId }, orderBy: { createdAt: "desc" } });
}
