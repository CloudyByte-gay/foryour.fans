import type { PayoutAccount, PrismaClient } from "@foryour-fans/database";
import { getPayoutAccountStatus, startPayoutOnboarding, type PayoutProvider } from "@foryour-fans/subscriptions";
import type { FastifyInstance } from "fastify";
import { requireCsrf, requireSession } from "../plugins/session.js";

export interface PayoutsRoutesOptions {
  prisma: PrismaClient;
  payoutProvider: PayoutProvider;
}

function toPayoutAccountResponse(account: PayoutAccount) {
  return {
    status: account.status,
    createdAt: account.createdAt,
    updatedAt: account.updatedAt,
  };
}

/**
 * A creator whose payout account is anything other than VERIFIED can still
 * publish and receive subscriptions — nothing in this file or elsewhere
 * gates that. Only real payout figures (Phase 13) are meant to be gated on
 * a VERIFIED PayoutAccount — see prompts/full.md's Phase 6 note.
 *
 * Starting onboarding IS gated on `Creator.verificationStatus` — the
 * identity/KYC field Phase 14 built — per prompts/full.md's Phase 14 note:
 * "make PayoutProvider onboarding (Phase 6) ... depend on it". This was
 * deliberately NOT gated when this file was first written (Phase 6, before
 * Phase 14 existed — a creator had no way to ever become VERIFIED yet, so
 * gating on it then would have made these routes permanently unusable);
 * now that Phase 14's `POST /creators/me/verification/submit` +
 * `POST /admin/creators/:id/verification/approve` give a creator a real
 * path to VERIFIED, that original reason no longer applies.
 */
export async function payoutsRoutes(app: FastifyInstance, { prisma, payoutProvider }: PayoutsRoutesOptions): Promise<void> {
  app.post("/creators/me/payout-account", { preHandler: [requireSession, requireCsrf] }, async (request, reply) => {
    const creator = await prisma.creator.findUnique({ where: { did: request.session!.did } });
    if (!creator) {
      return reply.status(404).send({ error: { message: "Not a creator yet.", statusCode: 404 } });
    }

    if (creator.verificationStatus !== "VERIFIED") {
      return reply.status(403).send({
        error: { message: "Only a verified creator may start payout onboarding.", statusCode: 403 },
      });
    }

    const { payoutAccount, onboardingUrl } = await startPayoutOnboarding(prisma, payoutProvider, creator);
    return reply.status(201).send({ ...toPayoutAccountResponse(payoutAccount), onboardingUrl });
  });

  app.get("/creators/me/payout-account/status", { preHandler: [requireSession] }, async (request, reply) => {
    const creator = await prisma.creator.findUnique({ where: { did: request.session!.did } });
    if (!creator) {
      return reply.status(404).send({ error: { message: "Not a creator yet.", statusCode: 404 } });
    }

    const account = await getPayoutAccountStatus(prisma, payoutProvider, creator.id);
    if (!account) {
      return reply.status(404).send({ error: { message: "Payout onboarding not started.", statusCode: 404 } });
    }
    return toPayoutAccountResponse(account);
  });
}
