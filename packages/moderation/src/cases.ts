import type { ModerationCase, ModerationSubjectType, PrismaClient, User } from "@foryour-fans/database";

export class ModerationCaseNotFoundError extends Error {}
export class ModerationCaseAlreadyResolvedError extends Error {}

/**
 * At most one OPEN case per subject is an application-level invariant, not a
 * DB constraint (see ModerationCase's doc comment in schema.prisma) —
 * enforced here by always looking for an existing OPEN row before creating
 * one. Repeat reports about the same subject accumulate onto one case
 * instead of scattering across many.
 */
export async function findOrOpenCase(
  prisma: PrismaClient,
  subjectType: ModerationSubjectType,
  subjectId: string,
): Promise<ModerationCase> {
  const existing = await prisma.moderationCase.findFirst({
    where: { subjectType, subjectId, status: "OPEN" },
  });
  if (existing) {
    return existing;
  }
  return prisma.moderationCase.create({ data: { subjectType, subjectId } });
}

export async function getCaseOrThrow(prisma: Pick<PrismaClient, "moderationCase">, caseId: string): Promise<ModerationCase> {
  const found = await prisma.moderationCase.findUnique({ where: { id: caseId } });
  if (!found) {
    throw new ModerationCaseNotFoundError("Moderation case not found.");
  }
  return found;
}

/** Every case referenced by moderationActions.ts must still be OPEN — a case is resolved exactly once. */
export function assertCaseOpen(moderationCase: ModerationCase): void {
  if (moderationCase.status !== "OPEN") {
    throw new ModerationCaseAlreadyResolvedError(`Case is already ${moderationCase.status.toLowerCase().replace("_", " ")}.`);
  }
}

export async function dismissCase(
  prisma: PrismaClient,
  admin: User,
  caseId: string,
  note?: string,
): Promise<ModerationCase> {
  const moderationCase = await getCaseOrThrow(prisma, caseId);

  return prisma.$transaction(async (tx) => {
    // Atomic claim: a separate assertCaseOpen check before this update
    // would let two concurrent resolutions of the same case both pass the
    // check before either writes. Only a caller whose conditional update
    // actually matches `status: "OPEN"` gets to dismiss it.
    const claimed = await tx.moderationCase.updateMany({
      where: { id: caseId, status: "OPEN" },
      data: { status: "DISMISSED", resolvedAt: new Date(), resolvedByUserId: admin.id, resolutionNote: note },
    });
    if (claimed.count === 0) {
      assertCaseOpen(await getCaseOrThrow(tx, caseId));
    }
    await tx.auditLog.create({
      data: {
        actorUserId: admin.id,
        actorRole: admin.role,
        action: "CASE_DISMISSED",
        targetType: moderationCase.subjectType,
        targetId: moderationCase.subjectId,
        moderationCaseId: caseId,
        metadata: note ? { note } : undefined,
      },
    });
    return getCaseOrThrow(tx, caseId);
  });
}

export async function listCases(
  prisma: PrismaClient,
  filter: { status?: "OPEN" | "ACTION_TAKEN" | "DISMISSED"; requiresLegalReview?: boolean } = {},
): Promise<ModerationCase[]> {
  return prisma.moderationCase.findMany({
    where: {
      status: filter.status,
      requiresLegalReview: filter.requiresLegalReview,
    },
    orderBy: [{ requiresLegalReview: "desc" }, { openedAt: "desc" }],
  });
}

export async function getCaseWithDetails(prisma: PrismaClient, caseId: string) {
  const moderationCase = await prisma.moderationCase.findUnique({
    where: { id: caseId },
    include: {
      reports: { orderBy: { createdAt: "asc" }, include: { reporterUser: { select: { id: true, did: true, handle: true } } } },
      labels: { orderBy: { cts: "desc" } },
      auditLogs: { orderBy: { createdAt: "asc" }, include: { actorUser: { select: { id: true, did: true, handle: true } } } },
    },
  });
  if (!moderationCase) {
    throw new ModerationCaseNotFoundError("Moderation case not found.");
  }
  return moderationCase;
}
