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
 * VERIFIED — see prompts/full.md's Phase 6 note.
 *
 * Not gated on Creator.verificationStatus either, deliberately: that field
 * is for the *identity/KYC* gate Phase 14 will build, which doesn't have a
 * way to become VERIFIED yet — gating payout onboarding on it now would
 * make these routes permanently unusable. When a REAL (non-fake)
 * PayoutProvider is introduced, gating *that* on verificationStatus is the
 * right place to enforce prompts/full.md's Phase 14 note, not here.
 */
export async function payoutsRoutes(app: FastifyInstance, { prisma, payoutProvider }: PayoutsRoutesOptions): Promise<void> {
  app.post("/creators/me/payout-account", { preHandler: [requireSession, requireCsrf] }, async (request, reply) => {
    const creator = await prisma.creator.findUnique({ where: { did: request.session!.did } });
    if (!creator) {
      return reply.status(404).send({ error: { message: "Not a creator yet.", statusCode: 404 } });
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
