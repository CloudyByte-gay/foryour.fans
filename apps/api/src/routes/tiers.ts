import type { PrismaClient, SubscriptionTier } from "@foryour-fans/database";
import { AtRecordDeleteError, AtRecordPublishError, type DeleteAtRecord, type PublishAtRecord } from "@foryour-fans/atproto";
import {
  TierNotFoundError,
  TierValidationError,
  createTier,
  deactivateTier,
  getOwnedTier,
  listActiveTiers,
  updateTier,
} from "@foryour-fans/subscriptions";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { requireCsrf, requireSession } from "../plugins/session.js";
import { findActiveCreatorByIdentifier } from "../services/creators.js";

export interface TiersRoutesOptions {
  prisma: PrismaClient;
  publishAtRecord: PublishAtRecord;
  deleteAtRecord: DeleteAtRecord;
}

const createBodySchema = z.object({
  name: z.string().trim().min(1).max(640),
  description: z.string().trim().max(10000).optional(),
  priceCents: z.number().int().positive(),
  currency: z.string().trim().toLowerCase().length(3),
  sortOrder: z.number().int().optional(),
});

const updateBodySchema = createBodySchema.partial();

function toPublicTier(tier: SubscriptionTier) {
  return {
    id: tier.id,
    name: tier.name,
    description: tier.description,
    priceCents: tier.priceCents,
    currency: tier.currency,
    sortOrder: tier.sortOrder,
    createdAt: tier.createdAt,
  };
}

function toOwnTier(tier: SubscriptionTier) {
  return {
    id: tier.id,
    name: tier.name,
    description: tier.description,
    priceCents: tier.priceCents,
    currency: tier.currency,
    sortOrder: tier.sortOrder,
    isActive: tier.isActive,
    createdAt: tier.createdAt,
    updatedAt: tier.updatedAt,
  };
}

function sendTierError(error: unknown, reply: FastifyReply): FastifyReply {
  if (error instanceof TierValidationError) {
    return reply.status(400).send({ error: { message: error.message, statusCode: 400 } });
  }
  if (error instanceof TierNotFoundError) {
    return reply.status(404).send({ error: { message: error.message, statusCode: 404 } });
  }
  if (error instanceof AtRecordPublishError || error instanceof AtRecordDeleteError) {
    reply.log.error({ err: error.cause }, "failed to sync subscription tier to AT network");
    return reply.status(502).send({ error: { message: error.message, statusCode: 502 } });
  }
  throw error;
}

export async function tiersRoutes(
  app: FastifyInstance,
  { prisma, publishAtRecord, deleteAtRecord }: TiersRoutesOptions,
): Promise<void> {
  app.post("/creators/me/tiers", { preHandler: [requireSession, requireCsrf] }, async (request, reply) => {
    const parsed = createBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { message: parsed.error.issues[0]?.message ?? "Invalid input.", statusCode: 400 } });
    }

    const creator = await prisma.creator.findUnique({ where: { did: request.session!.did } });
    if (!creator) {
      return reply.status(404).send({ error: { message: "Not a creator yet.", statusCode: 404 } });
    }

    try {
      const tier = await createTier(prisma, publishAtRecord, { creator, ...parsed.data });
      return reply.status(201).send(toOwnTier(tier));
    } catch (error) {
      return sendTierError(error, reply);
    }
  });

  app.patch("/creators/me/tiers/:tierId", { preHandler: [requireSession, requireCsrf] }, async (request, reply) => {
    const parsed = updateBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { message: parsed.error.issues[0]?.message ?? "Invalid input.", statusCode: 400 } });
    }

    const creator = await prisma.creator.findUnique({ where: { did: request.session!.did } });
    if (!creator) {
      return reply.status(404).send({ error: { message: "Not a creator yet.", statusCode: 404 } });
    }

    const { tierId } = request.params as { tierId: string };

    try {
      const tier = await getOwnedTier(prisma, creator.id, tierId);
      const updated = await updateTier(prisma, publishAtRecord, tier, creator.did, parsed.data);
      return toOwnTier(updated);
    } catch (error) {
      return sendTierError(error, reply);
    }
  });

  app.delete("/creators/me/tiers/:tierId", { preHandler: [requireSession, requireCsrf] }, async (request, reply) => {
    const creator = await prisma.creator.findUnique({ where: { did: request.session!.did } });
    if (!creator) {
      return reply.status(404).send({ error: { message: "Not a creator yet.", statusCode: 404 } });
    }

    const { tierId } = request.params as { tierId: string };

    try {
      const tier = await getOwnedTier(prisma, creator.id, tierId);
      const deactivated = await deactivateTier(prisma, deleteAtRecord, tier, creator.did);
      return toOwnTier(deactivated);
    } catch (error) {
      return sendTierError(error, reply);
    }
  });

  app.get("/creators/:identifier/tiers", async (request, reply) => {
    const { identifier } = request.params as { identifier: string };
    const creator = await findActiveCreatorByIdentifier(prisma, identifier);
    if (!creator) {
      return reply.status(404).send({ error: { message: "Creator not found.", statusCode: 404 } });
    }

    const tiers = await listActiveTiers(prisma, creator.id);
    return tiers.map(toPublicTier);
  });
}
