import type { PrismaClient, Subscription } from "@foryour-fans/database";
import {
  AlreadySubscribedError,
  SelfSubscriptionError,
  SubscriptionNotFoundError,
  TierNotFoundError,
  listOwnSubscriptions,
  setCancelAtPeriodEnd,
  subscribeToTier,
  type PaymentProvider,
  type SubscriptionWithContext,
} from "@foryour-fans/subscriptions";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { requireCsrf, requireSession } from "../plugins/session.js";
import { findActiveCreatorByIdentifier } from "../services/creators.js";

export interface SubscriptionsRoutesOptions {
  prisma: PrismaClient;
  paymentProvider: PaymentProvider;
}

const subscribeBodySchema = z.object({
  tierId: z.string().uuid(),
});

const patchBodySchema = z.object({
  cancelAtPeriodEnd: z.boolean(),
});

function toOwnSubscription(subscription: Subscription) {
  return {
    id: subscription.id,
    creatorId: subscription.creatorId,
    tierId: subscription.tierId,
    status: subscription.status,
    priceCentsAtSubscription: subscription.priceCentsAtSubscription,
    currencyAtSubscription: subscription.currencyAtSubscription,
    currentPeriodStart: subscription.currentPeriodStart,
    currentPeriodEnd: subscription.currentPeriodEnd,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
    createdAt: subscription.createdAt,
  };
}

function toListedSubscription(subscription: SubscriptionWithContext) {
  return {
    ...toOwnSubscription(subscription),
    creator: { did: subscription.creator.did, slug: subscription.creator.slug, displayName: subscription.creator.displayName },
    tier: { id: subscription.tier.id, name: subscription.tier.name },
  };
}

function sendSubscriptionError(error: unknown, reply: FastifyReply): FastifyReply {
  if (error instanceof TierNotFoundError) {
    return reply.status(404).send({ error: { message: error.message, statusCode: 404 } });
  }
  if (error instanceof SelfSubscriptionError) {
    return reply.status(400).send({ error: { message: error.message, statusCode: 400 } });
  }
  if (error instanceof AlreadySubscribedError) {
    return reply.status(409).send({ error: { message: error.message, statusCode: 409 } });
  }
  if (error instanceof SubscriptionNotFoundError) {
    return reply.status(404).send({ error: { message: error.message, statusCode: 404 } });
  }
  throw error;
}

export async function subscriptionsRoutes(
  app: FastifyInstance,
  { prisma, paymentProvider }: SubscriptionsRoutesOptions,
): Promise<void> {
  app.post("/creators/:identifier/subscribe", { preHandler: [requireSession, requireCsrf] }, async (request, reply) => {
    const parsed = subscribeBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { message: parsed.error.issues[0]?.message ?? "Invalid input.", statusCode: 400 } });
    }

    const { identifier } = request.params as { identifier: string };
    const creator = await findActiveCreatorByIdentifier(prisma, identifier);
    if (!creator) {
      return reply.status(404).send({ error: { message: "Creator not found.", statusCode: 404 } });
    }

    const user = await prisma.user.findUniqueOrThrow({ where: { did: request.session!.did } });

    try {
      const { subscription, redirectUrl } = await subscribeToTier(prisma, paymentProvider, {
        subscriberUserId: user.id,
        creator,
        tierId: parsed.data.tierId,
      });
      return reply.status(201).send({ ...toOwnSubscription(subscription), redirectUrl });
    } catch (error) {
      return sendSubscriptionError(error, reply);
    }
  });

  app.get("/subscriptions", { preHandler: [requireSession] }, async (request) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { did: request.session!.did } });
    const subscriptions = await listOwnSubscriptions(prisma, user.id);
    return subscriptions.map(toListedSubscription);
  });

  app.patch("/subscriptions/:id", { preHandler: [requireSession, requireCsrf] }, async (request, reply) => {
    const parsed = patchBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { message: parsed.error.issues[0]?.message ?? "Invalid input.", statusCode: 400 } });
    }

    const { id } = request.params as { id: string };
    const user = await prisma.user.findUniqueOrThrow({ where: { did: request.session!.did } });

    try {
      const updated = await setCancelAtPeriodEnd(prisma, paymentProvider, user.id, id, parsed.data.cancelAtPeriodEnd);
      return toOwnSubscription(updated);
    } catch (error) {
      return sendSubscriptionError(error, reply);
    }
  });
}
