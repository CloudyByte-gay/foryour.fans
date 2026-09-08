import type { AuditLog, ModerationCase, PrismaClient } from "@foryour-fans/database";
import {
  applyLabel,
  approveVerification,
  dismissCase,
  getCaseWithDetails,
  listCases,
  ModerationActionError,
  ModerationCaseAlreadyResolvedError,
  ModerationCaseNotFoundError,
  reinstateAccount,
  reinstateCreator,
  rejectVerification,
  removeContent,
  removeLabel,
  restrictAccount,
  suspendCreator,
  VerificationStateError,
} from "@foryour-fans/moderation";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { requireAdmin, requireCsrf, requireSession } from "../plugins/session.js";

export interface AdminRoutesOptions {
  prisma: PrismaClient;
}

function sendModerationError(error: unknown, reply: FastifyReply): FastifyReply {
  if (error instanceof ModerationCaseNotFoundError) {
    return reply.status(404).send({ error: { message: error.message, statusCode: 404 } });
  }
  if (error instanceof ModerationCaseAlreadyResolvedError || error instanceof ModerationActionError || error instanceof VerificationStateError) {
    return reply.status(409).send({ error: { message: error.message, statusCode: 409 } });
  }
  throw error;
}

function toCaseSummary(moderationCase: ModerationCase) {
  return {
    id: moderationCase.id,
    subjectType: moderationCase.subjectType,
    subjectId: moderationCase.subjectId,
    status: moderationCase.status,
    requiresLegalReview: moderationCase.requiresLegalReview,
    classifierSuggestion: moderationCase.classifierSuggestion,
    openedAt: moderationCase.openedAt,
    resolvedAt: moderationCase.resolvedAt,
    resolvedByUserId: moderationCase.resolvedByUserId,
    resolutionNote: moderationCase.resolutionNote,
  };
}

function toAuditLogEntry(log: AuditLog) {
  return {
    id: log.id,
    actorUserId: log.actorUserId,
    actorRole: log.actorRole,
    action: log.action,
    targetType: log.targetType,
    targetId: log.targetId,
    moderationCaseId: log.moderationCaseId,
    metadata: log.metadata,
    createdAt: log.createdAt,
  };
}

const listCasesQuerySchema = z.object({
  status: z.enum(["OPEN", "ACTION_TAKEN", "DISMISSED"]).optional(),
  requiresLegalReview: z.coerce.boolean().optional(),
});

const dismissCaseBodySchema = z.object({ note: z.string().trim().max(2000).optional() });

const applyLabelBodySchema = z.object({
  val: z.string().trim().min(1).max(128),
  exp: z.coerce.date().optional(),
});

const actionBodySchema = z.object({
  caseId: z.string().uuid().optional(),
  /** The admin console UI requires this; the field stays optional here since a caseId-linked action can also stand on the case's own reports. */
  reason: z.string().trim().max(2000).optional(),
});

const rejectVerificationBodySchema = z.object({ note: z.string().trim().max(2000).optional() });

const auditLogQuerySchema = z.object({
  targetType: z.enum(["CREATOR", "USER", "POST", "COMMENT"]).optional(),
  targetId: z.string().uuid().optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
});

/**
 * Phase 14 — the role-gated admin moderation console's API surface: review
 * reported content (GET /admin/cases[/:id]), restrict an account, remove
 * content, suspend a creator, and the append-only audit trail
 * (GET /admin/audit-log). Every mutating route here goes through
 * packages/moderation, which writes the AuditLog row itself — nothing in
 * this file writes to Postgres directly except via those functions, so
 * there's exactly one place sensitive actions get logged.
 */
export async function adminRoutes(app: FastifyInstance, { prisma }: AdminRoutesOptions): Promise<void> {
  // requireAdmin (plugins/session.ts) sets this once it confirms role: "ADMIN".
  app.decorateRequest("adminUser", undefined);

  app.get("/admin/cases", { preHandler: [requireSession, requireAdmin(prisma)] }, async (request, reply) => {
    const parsed = listCasesQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { message: parsed.error.issues[0]?.message ?? "Invalid query.", statusCode: 400 } });
    }
    const cases = await listCases(prisma, parsed.data);
    return cases.map(toCaseSummary);
  });

  app.get("/admin/cases/:caseId", { preHandler: [requireSession, requireAdmin(prisma)] }, async (request, reply) => {
    const { caseId } = request.params as { caseId: string };
    try {
      const details = await getCaseWithDetails(prisma, caseId);
      return {
        ...toCaseSummary(details),
        reports: details.reports.map((r) => ({
          id: r.id,
          reasonType: r.reasonType,
          reason: r.reason,
          createdAt: r.createdAt,
          reporter: r.reporterUser,
        })),
        labels: details.labels,
        auditLogs: details.auditLogs.map((l) => ({ ...toAuditLogEntry(l), actor: l.actorUser })),
      };
    } catch (error) {
      return sendModerationError(error, reply);
    }
  });

  app.post("/admin/cases/:caseId/dismiss", { preHandler: [requireSession, requireAdmin(prisma), requireCsrf] }, async (request, reply) => {
    const { caseId } = request.params as { caseId: string };
    const parsed = dismissCaseBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { message: parsed.error.issues[0]?.message ?? "Invalid input.", statusCode: 400 } });
    }
    try {
      const updated = await dismissCase(prisma, request.adminUser!, caseId, parsed.data.note);
      return toCaseSummary(updated);
    } catch (error) {
      return sendModerationError(error, reply);
    }
  });

  app.post("/admin/cases/:caseId/labels", { preHandler: [requireSession, requireAdmin(prisma), requireCsrf] }, async (request, reply) => {
    const { caseId } = request.params as { caseId: string };
    const parsed = applyLabelBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { message: parsed.error.issues[0]?.message ?? "Invalid input.", statusCode: 400 } });
    }

    const moderationCase = await prisma.moderationCase.findUnique({ where: { id: caseId } });
    if (!moderationCase) {
      return reply.status(404).send({ error: { message: "Moderation case not found.", statusCode: 404 } });
    }

    const label = await applyLabel(prisma, {
      subjectType: moderationCase.subjectType,
      subjectId: moderationCase.subjectId,
      val: parsed.data.val,
      exp: parsed.data.exp,
      moderationCaseId: caseId,
      appliedBy: request.adminUser!,
    });
    return reply.status(201).send(label);
  });

  app.delete("/admin/cases/:caseId/labels/:val", { preHandler: [requireSession, requireAdmin(prisma), requireCsrf] }, async (request, reply) => {
    const { caseId, val } = request.params as { caseId: string; val: string };
    const moderationCase = await prisma.moderationCase.findUnique({ where: { id: caseId } });
    if (!moderationCase) {
      return reply.status(404).send({ error: { message: "Moderation case not found.", statusCode: 404 } });
    }

    await removeLabel(prisma, {
      subjectType: moderationCase.subjectType,
      subjectId: moderationCase.subjectId,
      val,
      moderationCaseId: caseId,
      removedBy: request.adminUser!,
    });
    return reply.status(204).send();
  });

  app.post("/admin/posts/:postId/remove", { preHandler: [requireSession, requireAdmin(prisma), requireCsrf] }, async (request, reply) => {
    const { postId } = request.params as { postId: string };
    const parsed = actionBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: { message: "Invalid input.", statusCode: 400 } });
    }
    try {
      await removeContent(prisma, { admin: request.adminUser!, targetType: "POST", targetId: postId, caseId: parsed.data.caseId, reason: parsed.data.reason });
      return reply.status(204).send();
    } catch (error) {
      return sendModerationError(error, reply);
    }
  });

  app.post("/admin/comments/:commentId/remove", { preHandler: [requireSession, requireAdmin(prisma), requireCsrf] }, async (request, reply) => {
    const { commentId } = request.params as { commentId: string };
    const parsed = actionBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: { message: "Invalid input.", statusCode: 400 } });
    }
    try {
      await removeContent(prisma, { admin: request.adminUser!, targetType: "COMMENT", targetId: commentId, caseId: parsed.data.caseId, reason: parsed.data.reason });
      return reply.status(204).send();
    } catch (error) {
      return sendModerationError(error, reply);
    }
  });

  app.post("/admin/users/:userId/restrict", { preHandler: [requireSession, requireAdmin(prisma), requireCsrf] }, async (request, reply) => {
    const { userId } = request.params as { userId: string };
    const parsed = actionBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: { message: "Invalid input.", statusCode: 400 } });
    }
    try {
      await restrictAccount(prisma, { admin: request.adminUser!, userId, caseId: parsed.data.caseId, reason: parsed.data.reason });
      return reply.status(204).send();
    } catch (error) {
      return sendModerationError(error, reply);
    }
  });

  app.post("/admin/users/:userId/reinstate", { preHandler: [requireSession, requireAdmin(prisma), requireCsrf] }, async (request, reply) => {
    const { userId } = request.params as { userId: string };
    try {
      await reinstateAccount(prisma, request.adminUser!, userId);
      return reply.status(204).send();
    } catch (error) {
      return sendModerationError(error, reply);
    }
  });

  app.post("/admin/creators/:creatorId/suspend", { preHandler: [requireSession, requireAdmin(prisma), requireCsrf] }, async (request, reply) => {
    const { creatorId } = request.params as { creatorId: string };
    const parsed = actionBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: { message: "Invalid input.", statusCode: 400 } });
    }
    try {
      const creator = await suspendCreator(prisma, { admin: request.adminUser!, creatorId, caseId: parsed.data.caseId, reason: parsed.data.reason });
      return { status: creator.status };
    } catch (error) {
      return sendModerationError(error, reply);
    }
  });

  app.post("/admin/creators/:creatorId/reinstate", { preHandler: [requireSession, requireAdmin(prisma), requireCsrf] }, async (request, reply) => {
    const { creatorId } = request.params as { creatorId: string };
    try {
      const creator = await reinstateCreator(prisma, request.adminUser!, creatorId);
      return { status: creator.status };
    } catch (error) {
      return sendModerationError(error, reply);
    }
  });

  app.post(
    "/admin/creators/:creatorId/verification/approve",
    { preHandler: [requireSession, requireAdmin(prisma), requireCsrf] },
    async (request, reply) => {
      const { creatorId } = request.params as { creatorId: string };
      try {
        const creator = await approveVerification(prisma, request.adminUser!, creatorId);
        return { verificationStatus: creator.verificationStatus };
      } catch (error) {
        return sendModerationError(error, reply);
      }
    },
  );

  app.post(
    "/admin/creators/:creatorId/verification/reject",
    { preHandler: [requireSession, requireAdmin(prisma), requireCsrf] },
    async (request, reply) => {
      const { creatorId } = request.params as { creatorId: string };
      const parsed = rejectVerificationBodySchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.status(400).send({ error: { message: "Invalid input.", statusCode: 400 } });
      }
      try {
        const creator = await rejectVerification(prisma, request.adminUser!, creatorId, parsed.data.note);
        return { verificationStatus: creator.verificationStatus };
      } catch (error) {
        return sendModerationError(error, reply);
      }
    },
  );

  app.get("/admin/audit-log", { preHandler: [requireSession, requireAdmin(prisma)] }, async (request, reply) => {
    const parsed = auditLogQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { message: parsed.error.issues[0]?.message ?? "Invalid query.", statusCode: 400 } });
    }

    const logs = await prisma.auditLog.findMany({
      where: { targetType: parsed.data.targetType, targetId: parsed.data.targetId },
      orderBy: { createdAt: "desc" },
      take: parsed.data.limit ?? 50,
    });
    return logs.map(toAuditLogEntry);
  });
}
