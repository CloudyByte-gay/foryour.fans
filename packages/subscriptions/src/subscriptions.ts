import type { Creator, PrismaClient, Subscription, SubscriptionTier } from "@foryour-fans/database";
import { TierNotFoundError } from "./tiers.js";
import type { PaymentProvider } from "./providers/types.js";

export class SelfSubscriptionError extends Error {}
export class AlreadySubscribedError extends Error {}
export class SubscriptionNotFoundError extends Error {}

const ACTIVE_ISH_STATUSES = ["PENDING", "ACTIVE", "PAST_DUE"] as const;

export interface SubscribeInput {
  subscriberUserId: string;
  creator: Creator;
  tierId: string;
}

export interface SubscribeResult {
  subscription: Subscription;
  redirectUrl?: string;
}

/**
 * Creates a payment-provider customer (once per user, cached on
 * User.paymentCustomerId) and a subscription, then mirrors it locally with
 * the tier's CURRENT price/currency snapshotted onto the row — this is the
 * one and only time priceCentsAtSubscription is set; later tier price
 * changes never touch it (see SubscriptionTier's doc comment).
 *
 * A hosted-checkout provider (the assumed default shape — see
 * providers/types.ts) won't have confirmed anything yet at this point, so
 * the row starts PENDING and only becomes ACTIVE once the webhook fires;
 * `redirectUrl`, if the provider returned one, is where the caller should
 * send the browser next.
 */
export async function subscribeToTier(
  prisma: PrismaClient,
  paymentProvider: PaymentProvider,
  input: SubscribeInput,
): Promise<SubscribeResult> {
  const tier = await prisma.subscriptionTier.findUnique({ where: { id: input.tierId } });
  if (!tier || tier.creatorId !== input.creator.id || !tier.isActive) {
    throw new TierNotFoundError("Tier not found.");
  }

  if (input.creator.userId === input.subscriberUserId) {
    throw new SelfSubscriptionError("Creators can't subscribe to their own tiers.");
  }

  const existing = await prisma.subscription.findFirst({
    where: {
      subscriberUserId: input.subscriberUserId,
      creatorId: input.creator.id,
      status: { in: [...ACTIVE_ISH_STATUSES] },
    },
  });
  if (existing) {
    throw new AlreadySubscribedError("Already subscribed to this creator.");
  }

  const user = await prisma.user.findUniqueOrThrow({ where: { id: input.subscriberUserId } });
  let customerId = user.paymentCustomerId;
  if (!customerId) {
    const customer = await paymentProvider.createCustomer({ userId: user.id, handle: user.handle ?? undefined });
    customerId = customer.customerId;
    await prisma.user.update({ where: { id: user.id }, data: { paymentCustomerId: customerId } });
  }

  const providerResult = await paymentProvider.createSubscription({
    customerId,
    tierId: tier.id,
    priceCents: tier.priceCents,
    currency: tier.currency,
  });

  const subscription = await prisma.subscription.create({
    data: {
      subscriberUserId: input.subscriberUserId,
      creatorId: input.creator.id,
      tierId: tier.id,
      status: providerResult.status === "active" ? "ACTIVE" : "PENDING",
      provider: paymentProvider.name,
      providerSubscriptionId: providerResult.providerSubscriptionId,
      priceCentsAtSubscription: tier.priceCents,
      currencyAtSubscription: tier.currency,
    },
  });

  return { subscription, redirectUrl: providerResult.redirectUrl };
}

export type SubscriptionWithContext = Subscription & { creator: Creator; tier: SubscriptionTier };

export async function listOwnSubscriptions(prisma: PrismaClient, subscriberUserId: string): Promise<SubscriptionWithContext[]> {
  return prisma.subscription.findMany({
    where: { subscriberUserId },
    include: { creator: true, tier: true },
    orderBy: { createdAt: "desc" },
  });
}

/**
 * Toggles cancelAtPeriodEnd — matches prompts/full.md's top-level
 * requirement that subscribers can "cancel subscriptions" and
 * prompts/web.md's expectation of a toggle (cancel / resubscribe), not an
 * immediate termination: the subscriber keeps access through the period
 * they already paid for. When *setting* cancelAtPeriodEnd, the provider is
 * told not to renew — required, not best-effort, since silently failing to
 * inform the provider would mean it might charge again next period anyway.
 * Un-canceling (setting it back to false before the period ends) is
 * local-state-only: PaymentProvider has no "resume" method (matching
 * prompts/full.md's literal Phase 6 interface — createCustomer/
 * createSubscription/cancelSubscription/handleWebhook only), so there's
 * nothing to tell the provider.
 */
export async function setCancelAtPeriodEnd(
  prisma: PrismaClient,
  paymentProvider: PaymentProvider,
  subscriberUserId: string,
  subscriptionId: string,
  cancelAtPeriodEnd: boolean,
): Promise<Subscription> {
  const subscription = await prisma.subscription.findUnique({ where: { id: subscriptionId } });
  if (!subscription || subscription.subscriberUserId !== subscriberUserId) {
    throw new SubscriptionNotFoundError("Subscription not found.");
  }

  if (subscription.status === "CANCELED" || subscription.status === "EXPIRED") {
    return subscription;
  }

  if (cancelAtPeriodEnd && subscription.providerSubscriptionId) {
    await paymentProvider.cancelSubscription(subscription.providerSubscriptionId);
  }

  return prisma.subscription.update({ where: { id: subscription.id }, data: { cancelAtPeriodEnd } });
}
