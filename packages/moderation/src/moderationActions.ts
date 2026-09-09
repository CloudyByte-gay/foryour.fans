import type { AuditAction, Creator, ModerationSubjectType, Prisma, PrismaClient, User } from "@foryour-fans/database";
import { ModerationCaseAlreadyResolvedError } from "./cases.js";

export class ModerationActionError extends Error {}

type Tx = Prisma.TransactionClient;

interface RecordActionParams {
  admin: User;
  action: AuditAction;
  targetType: ModerationSubjectType;
  targetId: string;
  caseId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Atomically claims an OPEN case for resolution: only a caller whose
 * `updateMany` matches `status: "OPEN"` succeeds, so two concurrent admin
 * actions against the same case can't both pass a separate read-then-write
 * check and both believe they resolved it — "a case is resolved exactly
 * once" (see assertCaseOpen's doc comment in cases.ts) is enforced by this
 * single conditional write, not by a check before it.
 */
async function claimCase(tx: Tx, caseId: string, admin: User): Promise<void> {
  const claimed = await tx.moderationCase.updateMany({
    where: { id: caseId, status: "OPEN" },
    data: { status: "ACTION_TAKEN", resolvedAt: new Date(), resolvedByUserId: admin.id },
  });
  if (claimed.count === 0) {
    throw new ModerationCaseAlreadyResolvedError("Case is already resolved.");
  }
}

/**
 * Shared bookkeeping for every admin action below: writes the AuditLog row.
 * Every function in this file that changes something in response to a
 * report goes through this — see prompts/full.md's Phase 14 note
 * ("Sensitive moderation actions require audit logging"). Case resolution
 * itself is handled by `claimCase`, run earlier in the same transaction.
 */
async function recordAction(
  tx: Tx,
  { admin, action, targetType, targetId, caseId, metadata }: RecordActionParams,
): Promise<void> {
  await tx.auditLog.create({
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
}

export interface RemoveContentInput {
  admin: User;
  targetType: "POST" | "COMMENT";
  targetId: string;
  caseId?: string;
  /** Free-text justification, stored on the AuditLog row's metadata. The admin console UI requires this even though the field itself is optional here (an internal/scripted caller may not have one). */
  reason?: string;
}

/**
 * Soft-removes a post or comment. Reuses Post's existing `deletedAt` (Phase
 * 7) and Comment's new `deletedAt` (Phase 14) — same soft-delete mechanism
 * an author-initiated delete would use, so every read path that already
 * excludes a deleted post/comment (ContentRepository, listComments) also
 * hides a moderation-removed one with no additional filtering logic needed.
 */
export async function removeContent(prisma: PrismaClient, input: RemoveContentInput): Promise<void> {
  await prisma.$transaction(async (tx) => {
    if (input.caseId) {
      await claimCase(tx, input.caseId, input.admin);
    }

    if (input.targetType === "POST") {
      const post = await tx.post.findUnique({ where: { id: input.targetId } });
      if (!post || post.deletedAt) {
        throw new ModerationActionError("Post not found or already removed.");
      }
      await tx.post.update({ where: { id: input.targetId }, data: { deletedAt: new Date() } });
    } else {
      const comment = await tx.comment.findUnique({ where: { id: input.targetId } });
      if (!comment || comment.deletedAt) {
        throw new ModerationActionError("Comment not found or already removed.");
      }
      await tx.comment.update({ where: { id: input.targetId }, data: { deletedAt: new Date() } });
    }

    await recordAction(tx, {
      admin: input.admin,
      action: "CONTENT_REMOVED",
      targetType: input.targetType,
      targetId: input.targetId,
      caseId: input.caseId,
      metadata: input.reason ? { reason: input.reason } : undefined,
    });
  });
}

export interface RestrictAccountInput {
  admin: User;
  userId: string;
  caseId?: string;
  reason?: string;
}

/**
 * Sets User.status to RESTRICTED — see that field's doc comment in
 * schema.prisma for exactly what this blocks (comment/like/subscribe/
 * report/block) versus what it deliberately leaves untouched (login,
 * reading, existing subscriptions).
 */
export async function restrictAccount(prisma: PrismaClient, input: RestrictAccountInput): Promise<void> {
  await prisma.$transaction(async (tx) => {
    if (input.caseId) {
      await claimCase(tx, input.caseId, input.admin);
    }

    const user = await tx.user.findUnique({ where: { id: input.userId } });
    if (!user) {
      throw new ModerationActionError("User not found.");
    }

    await tx.user.update({ where: { id: input.userId }, data: { status: "RESTRICTED" } });
    await recordAction(tx, {
      admin: input.admin,
      action: "ACCOUNT_RESTRICTED",
      targetType: "USER",
      targetId: input.userId,
      caseId: input.caseId,
      metadata: { previousStatus: user.status, ...(input.reason ? { reason: input.reason } : {}) },
    });
  });
}

export async function reinstateAccount(prisma: PrismaClient, admin: User, userId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new ModerationActionError("User not found.");
    }

    await tx.user.update({ where: { id: userId }, data: { status: "ACTIVE" } });
    await recordAction(tx, { admin, action: "ACCOUNT_REINSTATED", targetType: "USER", targetId: userId });
  });
}

export interface SuspendCreatorInput {
  admin: User;
  creatorId: string;
  caseId?: string;
  reason?: string;
}

/** Sets Creator.status to SUSPENDED (Phase 4's existing enum) — a suspended creator is invisible to `resolveCreatorByIdentifier`, same as not existing (see docs/architecture.md). */
export async function suspendCreator(prisma: PrismaClient, input: SuspendCreatorInput): Promise<Creator> {
  return prisma.$transaction(async (tx) => {
    if (input.caseId) {
      await claimCase(tx, input.caseId, input.admin);
    }

    const creator = await tx.creator.findUnique({ where: { id: input.creatorId } });
    if (!creator) {
      throw new ModerationActionError("Creator not found.");
    }

    const updated = await tx.creator.update({ where: { id: input.creatorId }, data: { status: "SUSPENDED" } });
    await recordAction(tx, {
      admin: input.admin,
      action: "CREATOR_SUSPENDED",
      targetType: "CREATOR",
      targetId: input.creatorId,
      caseId: input.caseId,
      metadata: { previousStatus: creator.status, ...(input.reason ? { reason: input.reason } : {}) },
    });
    return updated;
  });
}

export async function reinstateCreator(prisma: PrismaClient, admin: User, creatorId: string): Promise<Creator> {
  return prisma.$transaction(async (tx) => {
    const creator = await tx.creator.findUnique({ where: { id: creatorId } });
    if (!creator) {
      throw new ModerationActionError("Creator not found.");
    }

    const updated = await tx.creator.update({ where: { id: creatorId }, data: { status: "ACTIVE" } });
    await recordAction(tx, { admin, action: "CREATOR_REINSTATED", targetType: "CREATOR", targetId: creatorId });
    return updated;
  });
}
