import type { PrismaClient } from "@foryour-fans/database";

export interface ModerationNotice {
  targetType: "POST" | "COMMENT";
  targetId: string;
  reason: string | null;
  removedAt: Date;
}

/**
 * WEB PHASE 14 audit fix — the spec's own "Moderation-notice banners on
 * restricted/removed content the viewer owns" was never built: `removeContent`
 * (moderationActions.ts) reuses Post/Comment's existing `deletedAt`
 * soft-delete column, the same one an author-initiated delete sets — every
 * read path that already excludes a deleted post/comment (including the
 * owner's own list) hides a moderator-removed one too, with nothing left
 * to distinguish "you deleted this" from "a moderator removed this."
 *
 * No schema change needed: a soft-deleted row the owner still has, cross-
 * referenced against `AuditLog`'s `CONTENT_REMOVED` entries (which only
 * `removeContent` ever writes — an author's own delete never does), tells
 * the two apart. Bounded to the caller's most recent soft-deleted rows
 * (`RECENT_LIMIT`) rather than their whole history — this is a lightweight
 * notice list, not an archive.
 */
const RECENT_LIMIT = 50;

export async function listModerationNotices(
  prisma: PrismaClient,
  did: string,
): Promise<ModerationNotice[]> {
  const [user, creator] = await Promise.all([
    prisma.user.findUnique({ where: { did } }),
    prisma.creator.findUnique({ where: { did } }),
  ]);
  if (!user) return [];

  const [removedPosts, removedComments] = await Promise.all([
    creator
      ? prisma.post.findMany({
          where: { creatorId: creator.id, deletedAt: { not: null } },
          orderBy: { deletedAt: "desc" },
          take: RECENT_LIMIT,
          select: { id: true },
        })
      : Promise.resolve([]),
    prisma.comment.findMany({
      where: { authorUserId: user.id, deletedAt: { not: null } },
      orderBy: { deletedAt: "desc" },
      take: RECENT_LIMIT,
      select: { id: true },
    }),
  ]);

  const postIds = removedPosts.map((p) => p.id);
  const commentIds = removedComments.map((c) => c.id);
  if (postIds.length === 0 && commentIds.length === 0) return [];

  const auditRows = await prisma.auditLog.findMany({
    where: {
      action: "CONTENT_REMOVED",
      OR: [
        ...(postIds.length > 0 ? [{ targetType: "POST" as const, targetId: { in: postIds } }] : []),
        ...(commentIds.length > 0 ? [{ targetType: "COMMENT" as const, targetId: { in: commentIds } }] : []),
      ],
    },
    orderBy: { createdAt: "desc" },
  });

  return auditRows.map((row) => ({
    targetType: row.targetType as "POST" | "COMMENT",
    targetId: row.targetId,
    reason: (row.metadata as { reason?: string } | null)?.reason ?? null,
    removedAt: row.createdAt,
  }));
}
