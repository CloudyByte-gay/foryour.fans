import type { AuditAction, Creator, ModerationSubjectType, PrismaClient, User } from "@foryour-fans/database";
import { assertCaseOpen, getCaseOrThrow } from "./cases.js";

export class ModerationActionError extends Error {}

interface RecordActionParams {
  admin: User;
  action: AuditAction;
  targetType: ModerationSubjectType;
  targetId: string;
  caseId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Shared bookkeeping for every admin action below: writes the AuditLog row
 * and, when the action is tied to a case, marks that case ACTION_TAKEN and
 * resolved by this admin. Every function in this file that changes
 * something in response to a report goes through this — see
 * prompts/full.md's Phase 14 note ("Sensitive moderation actions require
 * audit logging").
 */
async function recordAction(
  prisma: PrismaClient,
  { admin, action, targetType, targetId, caseId, metadata }: RecordActionParams,
): Promise<void> {
  await prisma.auditLog.create({
    data: {
      actorUserId: admin.id,
      actorRole: admin.role,
      action,
      targetType,
      targetId,
      moderationCaseId: caseId,
      metadata: metadata as object | undefined,
    },
  });

  if (caseId) {
    await prisma.moderationCase.update({
      where: { id: caseId },
      data: { status: "ACTION_TAKEN", resolvedAt: new Date(), resolvedByUserId: admin.id },
    });
  }
}

export interface RemoveContentInput {
  admin: User;
  targetType: "POST" | "COMMENT";
  targetId: string;
  caseId?: string;
}

/**
 * Soft-removes a post or comment. Reuses Post's existing `deletedAt` (Phase
 * 7) and Comment's new `deletedAt` (Phase 14) — same soft-delete mechanism
 * an author-initiated delete would use, so every read path that already
 * excludes a deleted post/comment (ContentRepository, listComments) also
 * hides a moderation-removed one with no additional filtering logic needed.
 */
export async function removeContent(prisma: PrismaClient, input: RemoveContentInput): Promise<void> {
  if (input.caseId) {
    assertCaseOpen(await getCaseOrThrow(prisma, input.caseId));
  }

  if (input.targetType === "POST") {
    const post = await prisma.post.findUnique({ where: { id: input.targetId } });
    if (!post || post.deletedAt) {
      throw new ModerationActionError("Post not found or already removed.");
    }
    await prisma.post.update({ where: { id: input.targetId }, data: { deletedAt: new Date() } });
  } else {
    const comment = await prisma.comment.findUnique({ where: { id: input.targetId } });
    if (!comment || comment.deletedAt) {
      throw new ModerationActionError("Comment not found or already removed.");
    }
    await prisma.comment.update({ where: { id: input.targetId }, data: { deletedAt: new Date() } });
  }

  await recordAction(prisma, {
    admin: input.admin,
    action: "CONTENT_REMOVED",
    targetType: input.targetType,
    targetId: input.targetId,
    caseId: input.caseId,
  });
}

export interface RestrictAccountInput {
  admin: User;
  userId: string;
  caseId?: string;
}

/**
 * Sets User.status to RESTRICTED — see that field's doc comment in
 * schema.prisma for exactly what this blocks (comment/like/subscribe/
 * report/block) versus what it deliberately leaves untouched (login,
 * reading, existing subscriptions).
 */
export async function restrictAccount(prisma: PrismaClient, input: RestrictAccountInput): Promise<void> {
  if (input.caseId) {
    assertCaseOpen(await getCaseOrThrow(prisma, input.caseId));
  }

  const user = await prisma.user.findUnique({ where: { id: input.userId } });
  if (!user) {
    throw new ModerationActionError("User not found.");
  }

  await prisma.user.update({ where: { id: input.userId }, data: { status: "RESTRICTED" } });
  await recordAction(prisma, {
    admin: input.admin,
    action: "ACCOUNT_RESTRICTED",
    targetType: "USER",
    targetId: input.userId,
    caseId: input.caseId,
    metadata: { previousStatus: user.status },
  });
}

export async function reinstateAccount(prisma: PrismaClient, admin: User, userId: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new ModerationActionError("User not found.");
  }

  await prisma.user.update({ where: { id: userId }, data: { status: "ACTIVE" } });
  await recordAction(prisma, { admin, action: "ACCOUNT_REINSTATED", targetType: "USER", targetId: userId });
}

export interface SuspendCreatorInput {
  admin: User;
  creatorId: string;
  caseId?: string;
}

/** Sets Creator.status to SUSPENDED (Phase 4's existing enum) — a suspended creator is invisible to `resolveCreatorByIdentifier`, same as not existing (see docs/architecture.md). */
export async function suspendCreator(prisma: PrismaClient, input: SuspendCreatorInput): Promise<Creator> {
  if (input.caseId) {
    assertCaseOpen(await getCaseOrThrow(prisma, input.caseId));
  }

  const creator = await prisma.creator.findUnique({ where: { id: input.creatorId } });
  if (!creator) {
    throw new ModerationActionError("Creator not found.");
  }

  const updated = await prisma.creator.update({ where: { id: input.creatorId }, data: { status: "SUSPENDED" } });
  await recordAction(prisma, {
    admin: input.admin,
    action: "CREATOR_SUSPENDED",
    targetType: "CREATOR",
    targetId: input.creatorId,
    caseId: input.caseId,
    metadata: { previousStatus: creator.status },
  });
  return updated;
}

export async function reinstateCreator(prisma: PrismaClient, admin: User, creatorId: string): Promise<Creator> {
  const creator = await prisma.creator.findUnique({ where: { id: creatorId } });
  if (!creator) {
    throw new ModerationActionError("Creator not found.");
  }

  const updated = await prisma.creator.update({ where: { id: creatorId }, data: { status: "ACTIVE" } });
  await recordAction(prisma, { admin, action: "CREATOR_REINSTATED", targetType: "CREATOR", targetId: creatorId });
  return updated;
}
