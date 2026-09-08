import type { PrismaClient } from "@foryour-fans/database";
import {
  createReport,
  listModerationNotices,
  ReportSubjectNotFoundError,
  ReportValidationError,
  type ContentClassifier,
} from "@foryour-fans/moderation";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireCsrf, requireNotRestricted, requireSession } from "../plugins/session.js";

export interface ReportsRoutesOptions {
  prisma: PrismaClient;
  classifier: ContentClassifier;
}

const createReportBodySchema = z.object({
  subjectType: z.enum(["CREATOR", "USER", "POST", "COMMENT"]),
  subjectId: z.string().uuid(),
  reasonType: z.enum(["SPAM", "HARASSMENT", "IMPERSONATION", "SEXUAL_CONTENT_VIOLATION", "NCII", "COPYRIGHT", "ILLEGAL_CONTENT", "OTHER"]),
  reason: z.string().trim().max(20_000).optional(),
});

function toReportResponse(report: { id: string; subjectType: string; subjectId: string; reasonType: string; createdAt: Date; moderationCaseId: string }) {
  return {
    id: report.id,
    subjectType: report.subjectType,
    subjectId: report.subjectId,
    reasonType: report.reasonType,
    createdAt: report.createdAt,
    moderationCaseId: report.moderationCaseId,
  };
}

/**
 * Phase 14 — user-facing report filing ("report creator", "report post",
 * "report comment"; a report against a USER subject covers the "report
 * user" case comments and DMs would otherwise need). Request shape mirrors
 * com.atproto.moderation.createReport — see Report's schema.prisma doc
 * comment for why. Not gated on entitlement to the reported content
 * (unlike comments/likes) — filing a report should never require the
 * reporter to already have access to whatever they're flagging, which
 * would be backwards for e.g. reporting content only visible behind a
 * paywall they've already left.
 */
export async function reportsRoutes(app: FastifyInstance, { prisma, classifier }: ReportsRoutesOptions): Promise<void> {
  app.post(
    "/reports",
    { preHandler: [requireSession, requireCsrf, requireNotRestricted(prisma)] },
    async (request, reply) => {
      const parsed = createReportBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: { message: parsed.error.issues[0]?.message ?? "Invalid input.", statusCode: 400 } });
      }

      const reporter = await prisma.user.findUnique({ where: { did: request.session!.did } });
      if (!reporter) {
        return reply.status(401).send({ error: { message: "Session user not found.", statusCode: 401 } });
      }

      try {
        const report = await createReport(prisma, classifier, { reporterUserId: reporter.id, ...parsed.data });
        return reply.status(201).send(toReportResponse(report));
      } catch (error) {
        if (error instanceof ReportValidationError) {
          return reply.status(400).send({ error: { message: error.message, statusCode: 400 } });
        }
        if (error instanceof ReportSubjectNotFoundError) {
          return reply.status(404).send({ error: { message: error.message, statusCode: 404 } });
        }
        throw error;
      }
    },
  );

  /**
   * WEB PHASE 14 audit fix — "Moderation-notice banners on restricted/
   * removed content the viewer owns," named in the phase's own spec but
   * never built. Read-only; see listModerationNotices' own doc comment for
   * how it tells a moderator removal apart from the caller's own delete
   * with no schema change.
   */
  app.get("/me/moderation-notices", { preHandler: [requireSession] }, async (request) => {
    const notices = await listModerationNotices(prisma, request.session!.did);
    return { notices };
  });
}
