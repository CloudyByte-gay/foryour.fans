import type { ContentLabel, ModerationSubjectType, PrismaClient, User } from "@foryour-fans/database";

export class LabelValidationError extends Error {}

/**
 * com.atproto.label.defs's own vocabulary (already used by
 * fans.foryour.post's creator self-labels), plus platform-specific values
 * for moderator/classifier-applied labels this platform needs that aren't
 * in the standard set — custom label values are a normal, expected part of
 * the labeler system (see ContentLabel's doc comment in schema.prisma), not
 * a deviation from it.
 */
export const KNOWN_LABEL_VALUES = [
  // com.atproto.label.defs#labelValue
  "porn",
  "sexual",
  "nudity",
  "graphic-media",
  // platform-specific
  "spam",
  "ncii-review",
  "takedown",
] as const;

export interface ApplyLabelInput {
  subjectType: ModerationSubjectType;
  subjectId: string;
  subjectUri?: string;
  val: string;
  exp?: Date;
  moderationCaseId?: string;
  /** The admin applying this label. Every current call site is admin-invoked (see classifiers/types.ts's doc comment on why classifiers only suggest, never apply). */
  appliedBy: User;
}

export async function applyLabel(prisma: PrismaClient, input: ApplyLabelInput): Promise<ContentLabel> {
  if (input.val.trim().length === 0) {
    throw new LabelValidationError("Label value is required.");
  }

  return prisma.$transaction(async (tx) => {
    const label = await tx.contentLabel.create({
      data: {
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        subjectUri: input.subjectUri,
        val: input.val,
        exp: input.exp,
        moderationCaseId: input.moderationCaseId,
        appliedByUserId: input.appliedBy.id,
      },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: input.appliedBy.id,
        actorRole: input.appliedBy.role,
        action: "LABEL_APPLIED",
        targetType: input.subjectType,
        targetId: input.subjectId,
        moderationCaseId: input.moderationCaseId,
        metadata: { val: input.val },
      },
    });
    return label;
  });
}

export interface RemoveLabelInput {
  subjectType: ModerationSubjectType;
  subjectId: string;
  val: string;
  moderationCaseId?: string;
  removedBy: User;
}

/**
 * Retracts a label by inserting a NEW row with `neg: true` for the same
 * (subjectType, subjectId, val) — the real label protocol's own retraction
 * mechanism (see ContentLabel's doc comment), not a mutation of the
 * original row.
 */
export async function removeLabel(prisma: PrismaClient, input: RemoveLabelInput): Promise<ContentLabel> {
  return prisma.$transaction(async (tx) => {
    const negation = await tx.contentLabel.create({
      data: {
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        val: input.val,
        neg: true,
        moderationCaseId: input.moderationCaseId,
        appliedByUserId: input.removedBy.id,
      },
    });
    await tx.auditLog.create({
      data: {
        actorUserId: input.removedBy.id,
        actorRole: input.removedBy.role,
        action: "LABEL_REMOVED",
        targetType: input.subjectType,
        targetId: input.subjectId,
        moderationCaseId: input.moderationCaseId,
        metadata: { val: input.val },
      },
    });
    return negation;
  });
}

/**
 * Net-effective labels for a subject: the latest row per `val`, dropped if
 * that latest row is a negation. Mirrors how a real label-consuming client
 * resolves a label's current state from a stream of label/negation events.
 */
export async function listEffectiveLabels(prisma: PrismaClient, subjectType: ModerationSubjectType, subjectId: string): Promise<ContentLabel[]> {
  const rows = await prisma.contentLabel.findMany({
    where: { subjectType, subjectId },
    orderBy: { cts: "asc" },
  });

  const latestByVal = new Map<string, ContentLabel>();
  for (const row of rows) {
    latestByVal.set(row.val, row);
  }

  return [...latestByVal.values()].filter((row) => !row.neg);
}
