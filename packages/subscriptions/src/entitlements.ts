import type { PrismaClient } from "@foryour-fans/database";

export interface CanAccessParams {
  subscriberDid: string;
  creatorDid: string;
  /** A SubscriptionTier id. Omit for "any active subscription to this creator suffices" (matches Phase 7's SUBSCRIBERS visibility). */
  requiredTierId?: string;
}

/**
 * The single source of truth for "can this DID see this creator's gated
 * content" — Phase 7's private-content routes will call this directly
 * rather than re-deriving access logic themselves.
 *
 * Design decisions worth knowing about:
 * - A creator always has access to their own content (checked first, no
 *   DB query needed) — matches Phase 7's expected test suite.
 * - Only `ACTIVE` subscriptions grant access. `PAST_DUE` does not: a
 *   failed payment pauses access immediately rather than granting a grace
 *   period, which is the conservative/safe-by-default choice absent any
 *   spec requirement either way.
 * - `requiredTierId`, when given, is checked via `SubscriptionTier.sortOrder`
 *   hierarchy, not exact match: a subscriber's tier grants access to any
 *   post gated at that tier's `sortOrder` *or lower* — reading Phase 7's
 *   "minimumTierId" field name as "the minimum tier that grants access",
 *   the conventional meaning for a tiered-subscription platform. This
 *   assumes creators set sortOrder ascending from lowest to highest tier;
 *   nothing enforces that today (sortOrder is otherwise just a display
 *   order — see docs/architecture.md), so revisit if Phase 7 reveals a
 *   different intent.
 */
export async function canAccess(prisma: PrismaClient, params: CanAccessParams): Promise<boolean> {
  if (params.subscriberDid === params.creatorDid) {
    return true;
  }

  const creator = await prisma.creator.findUnique({ where: { did: params.creatorDid } });
  if (!creator || creator.status !== "ACTIVE") {
    return false;
  }

  const subscriber = await prisma.user.findUnique({ where: { did: params.subscriberDid } });
  if (!subscriber) {
    return false;
  }

  const subscription = await prisma.subscription.findFirst({
    where: { subscriberUserId: subscriber.id, creatorId: creator.id, status: "ACTIVE" },
    include: { tier: true },
  });
  if (!subscription) {
    return false;
  }

  if (!params.requiredTierId) {
    return true;
  }
  if (subscription.tierId === params.requiredTierId) {
    return true;
  }

  const requiredTier = await prisma.subscriptionTier.findUnique({ where: { id: params.requiredTierId } });
  if (!requiredTier) {
    // Gating content against a tier that no longer exists: fail closed.
    return false;
  }

  return subscription.tier.sortOrder >= requiredTier.sortOrder;
}
