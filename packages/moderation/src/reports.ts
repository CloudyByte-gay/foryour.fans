import type { ModerationSubjectType, PrismaClient, Report, ReportReason } from "@foryour-fans/database";
import type { ContentClassifier } from "./classifiers/types.js";
import { findOrOpenCase } from "./cases.js";

export class ReportValidationError extends Error {}
export class ReportSubjectNotFoundError extends Error {}

/**
 * Reason categories prompts/full.md's Phase 14 note calls out as needing a
 * distinct external-escalation path (NCII, illegal content — CSAM and
 * similarly urgent material falls under ILLEGAL_CONTENT, since this app
 * does not attempt to enumerate every jurisdiction's illegal-content
 * categories itself; see docs/architecture.md's "Legal/compliance review
 * required" section). A report in one of these categories flags its case
 * for mandatory human legal/compliance review — this app does NOT file any
 * external report (NCMEC, DMCA, law enforcement, …) itself.
 */
const REASONS_REQUIRING_LEGAL_REVIEW: ReadonlySet<ReportReason> = new Set(["NCII", "ILLEGAL_CONTENT"]);

export function reasonRequiresLegalReview(reasonType: ReportReason): boolean {
  return REASONS_REQUIRING_LEGAL_REVIEW.has(reasonType);
}

async function assertSubjectExists(prisma: PrismaClient, subjectType: ModerationSubjectType, subjectId: string): Promise<void> {
  switch (subjectType) {
    case "CREATOR": {
      const creator = await prisma.creator.findUnique({ where: { id: subjectId } });
      if (!creator) throw new ReportSubjectNotFoundError("Creator not found.");
      return;
    }
    case "USER": {
      const user = await prisma.user.findUnique({ where: { id: subjectId } });
      if (!user) throw new ReportSubjectNotFoundError("User not found.");
      return;
    }
    case "POST": {
      const post = await prisma.post.findUnique({ where: { id: subjectId } });
      if (!post || post.deletedAt) throw new ReportSubjectNotFoundError("Post not found.");
      return;
    }
    case "COMMENT": {
      const comment = await prisma.comment.findUnique({ where: { id: subjectId } });
      if (!comment || comment.deletedAt) throw new ReportSubjectNotFoundError("Comment not found.");
      return;
    }
  }
}

export interface CreateReportInput {
  reporterUserId: string;
  subjectType: ModerationSubjectType;
  subjectId: string;
  reasonType: ReportReason;
  reason?: string;
}

/**
 * Files a report — request shape mirrors com.atproto.moderation.createReport
 * (see Report's schema.prisma doc comment). Finds or opens the subject's
 * moderation case (so repeat reports accumulate, see cases.ts), asks the
 * injected ContentClassifier for a triage suggestion (stored on the case,
 * never acted on automatically — see classifiers/types.ts), and flags the
 * case for legal review when the reason category requires it.
 */
export async function createReport(
  prisma: PrismaClient,
  classifier: ContentClassifier,
  input: CreateReportInput,
): Promise<Report> {
  if (input.reason !== undefined && input.reason.length > 20_000) {
    throw new ReportValidationError("Report reason must be 20,000 characters or fewer.");
  }

  await assertSubjectExists(prisma, input.subjectType, input.subjectId);

  const moderationCase = await findOrOpenCase(prisma, input.subjectType, input.subjectId);

  const suggestion = await classifier.suggestForReport({
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    reasonType: input.reasonType,
    reason: input.reason ?? null,
  });

  const requiresLegalReview = moderationCase.requiresLegalReview || reasonRequiresLegalReview(input.reasonType);

  return prisma.$transaction(async (tx) => {
    if (requiresLegalReview !== moderationCase.requiresLegalReview || suggestion) {
      await tx.moderationCase.update({
        where: { id: moderationCase.id },
        data: {
          requiresLegalReview,
          ...(suggestion ? { classifierSuggestion: suggestion as object } : {}),
        },
      });
    }

    return tx.report.create({
      data: {
        reporterUserId: input.reporterUserId,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        reasonType: input.reasonType,
        reason: input.reason,
        moderationCaseId: moderationCase.id,
      },
    });
  });
}

export async function listReportsForSubject(prisma: PrismaClient, subjectType: ModerationSubjectType, subjectId: string): Promise<Report[]> {
  return prisma.report.findMany({ where: { subjectType, subjectId }, orderBy: { createdAt: "desc" } });
}
