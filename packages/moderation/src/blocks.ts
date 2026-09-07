import type { PrismaClient, User, UserBlock } from "@foryour-fans/database";
import {
  AtRecordDeleteError,
  AtRecordPublishError,
  buildBskyBlockRecord,
  nextTid,
  type DeleteAtRecord,
  type PublishAtRecord,
} from "@foryour-fans/atproto";
import { BSKY_NSID } from "@foryour-fans/lexicons";

export class BlockValidationError extends Error {}

/**
 * Publishes a real `app.bsky.graph.block` record to the blocker's own PDS,
 * THEN creates the local cache row — same AT-write-first discipline as
 * SubscriptionTier (Phase 5). See packages/atproto/src/bskyBlock.ts for why
 * this reuses Bluesky's own record type instead of an app-private one.
 * Idempotent: blocking an already-blocked user returns the existing row
 * without re-publishing (mirrors `startPayoutOnboarding`'s idempotency —
 * packages/subscriptions/src/payoutAccounts.ts).
 */
export async function blockUser(
  prisma: PrismaClient,
  publishAtRecord: PublishAtRecord,
  blocker: User,
  blocked: User,
): Promise<UserBlock> {
  if (blocker.id === blocked.id) {
    throw new BlockValidationError("Cannot block yourself.");
  }

  const existing = await prisma.userBlock.findUnique({
    where: { blockerUserId_blockedUserId: { blockerUserId: blocker.id, blockedUserId: blocked.id } },
  });
  if (existing) {
    return existing;
  }

  const rkey = nextTid();
  const record = buildBskyBlockRecord({ subjectDid: blocked.did });

  let published;
  try {
    published = await publishAtRecord(blocker.did, { collection: BSKY_NSID.graphBlock, rkey, record });
  } catch (error) {
    throw new AtRecordPublishError("Failed to publish block record to the AT network.", error);
  }

  return prisma.userBlock.create({
    data: {
      blockerUserId: blocker.id,
      blockedUserId: blocked.id,
      atUri: published.uri,
      atCid: published.cid,
      atRkey: rkey,
    },
  });
}

/** Deletes the AT record BEFORE the local row — mirrors deactivateTier's ordering (packages/subscriptions/src/tiers.ts). A no-op if the block doesn't exist. */
export async function unblockUser(
  prisma: PrismaClient,
  deleteAtRecord: DeleteAtRecord,
  blockerUserId: string,
  blockedUserId: string,
): Promise<void> {
  const existing = await prisma.userBlock.findUnique({
    where: { blockerUserId_blockedUserId: { blockerUserId, blockedUserId } },
    include: { blockerUser: { select: { did: true } } },
  });
  if (!existing) {
    return;
  }

  try {
    await deleteAtRecord(existing.blockerUser.did, { collection: BSKY_NSID.graphBlock, rkey: existing.atRkey });
  } catch (error) {
    throw new AtRecordDeleteError("Failed to remove block record from the AT network.", error);
  }

  await prisma.userBlock.delete({ where: { id: existing.id } });
}

export async function listBlockedUserIds(prisma: PrismaClient, blockerUserId: string): Promise<string[]> {
  const rows = await prisma.userBlock.findMany({ where: { blockerUserId }, select: { blockedUserId: true } });
  return rows.map((r) => r.blockedUserId);
}

export async function listBlocks(prisma: PrismaClient, blockerUserId: string): Promise<UserBlock[]> {
  return prisma.userBlock.findMany({ where: { blockerUserId }, orderBy: { createdAt: "desc" } });
}

/**
 * True if either user has blocked the other — matches how most platforms
 * apply a mutual-visibility rule for blocks.
 */
export async function isBlockedEitherWay(prisma: PrismaClient, userIdA: string, userIdB: string): Promise<boolean> {
  const block = await prisma.userBlock.findFirst({
    where: {
      OR: [
        { blockerUserId: userIdA, blockedUserId: userIdB },
        { blockerUserId: userIdB, blockedUserId: userIdA },
      ],
    },
    select: { id: true },
  });
  return block !== null;
}

/**
 * DIDs of everyone in a mutual-block relationship with this user, in one
 * query — used to filter a list of already-fetched rows (e.g. a comment
 * thread, apps/api/src/routes/comments.ts) by `author.did` without an
 * isBlockedEitherWay round trip per row.
 */
export async function listBlockedEitherWayDids(prisma: PrismaClient, userId: string): Promise<Set<string>> {
  const rows = await prisma.userBlock.findMany({
    where: { OR: [{ blockerUserId: userId }, { blockedUserId: userId }] },
    include: {
      blockerUser: { select: { id: true, did: true } },
      blockedUser: { select: { id: true, did: true } },
    },
  });

  const dids = new Set<string>();
  for (const row of rows) {
    const other = row.blockerUserId === userId ? row.blockedUser : row.blockerUser;
    dids.add(other.did);
  }
  return dids;
}
