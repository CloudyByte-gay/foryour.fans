import type { PrismaClient } from "@foryour-fans/database";
import { submitVerification, VerificationStateError } from "@foryour-fans/moderation";
import type { FastifyInstance } from "fastify";
import { requireCsrf, requireSession } from "../plugins/session.js";

export interface VerificationRoutesOptions {
  prisma: PrismaClient;
}

/**
 * Phase 14 — creator-initiated identity verification submission
 * (UNVERIFIED -> PENDING). See packages/moderation/src/verification.ts's
 * doc comment: this is a placeholder for a real KYC integration, not one —
 * no document upload, no vendor call. Admin approval/rejection lives under
 * /admin (routes/admin.ts), gated on `role: "ADMIN"`.
 */
export async function verificationRoutes(app: FastifyInstance, { prisma }: VerificationRoutesOptions): Promise<void> {
  app.post("/creators/me/verification/submit", { preHandler: [requireSession, requireCsrf] }, async (request, reply) => {
    const creator = await prisma.creator.findUnique({ where: { did: request.session!.did } });
    if (!creator) {
      return reply.status(404).send({ error: { message: "Not a creator yet.", statusCode: 404 } });
    }

    try {
      const updated = await submitVerification(prisma, creator);
      return { verificationStatus: updated.verificationStatus };
    } catch (error) {
      if (error instanceof VerificationStateError) {
        return reply.status(409).send({ error: { message: error.message, statusCode: 409 } });
      }
      throw error;
    }
  });
}
