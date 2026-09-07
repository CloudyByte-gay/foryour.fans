import type { Creator, PrismaClient, SubscriptionTier } from "@foryour-fans/database";
import { NSID } from "@foryour-fans/lexicons";
import {
  AtRecordDeleteError,
  AtRecordPublishError,
  nextTid,
  type DeleteAtRecord,
  type PublishAtRecord,
} from "@foryour-fans/atproto";

export class TierValidationError extends Error {}
export class TierNotFoundError extends Error {}

const CURRENCY_PATTERN = /^[a-z]{3}$/;

export interface TierFields {
  name: string;
  description?: string;
  priceCents: number;
  currency: string;
  sortOrder?: number;
  /**
   * Phase 14 — Postgres-only bookkeeping, deliberately NOT part of
   * `tierRecord()`'s AT record below: `fans.foryour.tier` has no such field,
   * and this is a moderation/verification gate on the creator, not public
   * tier metadata. The VERIFIED-creator check itself lives in
   * apps/api/src/routes/tiers.ts.
   */
  containsAdultContent?: boolean;
}

export function validateTierFields(fields: Partial<TierFields>): void {
  if (fields.name !== undefined && fields.name.trim().length === 0) {
    throw new TierValidationError("Tier name is required.");
  }
  if (fields.priceCents !== undefined) {
    if (!Number.isInteger(fields.priceCents) || fields.priceCents <= 0) {
      throw new TierValidationError("priceCents must be a positive integer (minor units, e.g. cents).");
    }
  }
  if (fields.currency !== undefined && !CURRENCY_PATTERN.test(fields.currency)) {
    throw new TierValidationError('currency must be a 3-letter lowercase ISO 4217 code, e.g. "usd".');
  }
}

function tierRecord(fields: TierFields, createdAt: Date): Record<string, unknown> {
  return {
    $type: NSID.tier,
    name: fields.name,
    description: fields.description,
    monthlyPrice: fields.priceCents,
    currency: fields.currency,
    sortOrder: fields.sortOrder,
    createdAt: createdAt.toISOString(),
  };
}

export interface CreateTierInput extends TierFields {
  creator: Creator;
}

/**
 * Same ordering discipline as apps/api's services/creators.ts: publish the
 * tier AT record first, then create the local row. A SubscriptionTier must
 * never exist locally without a corresponding public AT record — see
 * docs/atproto-vs-database.md.
 */
export async function createTier(
  prisma: PrismaClient,
  publishAtRecord: PublishAtRecord,
  input: CreateTierInput,
): Promise<SubscriptionTier> {
  validateTierFields(input);

  const rkey = nextTid();
  const now = new Date();

  try {
    await publishAtRecord(input.creator.did, {
      collection: NSID.tier,
      rkey,
      record: tierRecord(input, now),
    });
  } catch (error) {
    throw new AtRecordPublishError("Failed to publish subscription tier to the AT network.", error);
  }

  return prisma.subscriptionTier.create({
    data: {
      creatorId: input.creator.id,
      name: input.name,
      description: input.description,
      priceCents: input.priceCents,
      currency: input.currency,
      sortOrder: input.sortOrder ?? 0,
      atRkey: rkey,
      containsAdultContent: input.containsAdultContent ?? false,
    },
  });
}

export interface UpdateTierInput {
  name?: string;
  description?: string;
  priceCents?: number;
  currency?: string;
  sortOrder?: number;
  /** Phase 14 — see TierFields.containsAdultContent above. */
  containsAdultContent?: boolean;
}

/**
 * Every field a tier PATCH can touch is part of the public AT record, so any
 * non-empty patch republishes it — using the merged (new + existing) field
 * set, since putRecord replaces the whole record.
 */
export async function updateTier(
  prisma: PrismaClient,
  publishAtRecord: PublishAtRecord,
  tier: SubscriptionTier,
  creatorDid: string,
  patch: UpdateTierInput,
): Promise<SubscriptionTier> {
  validateTierFields(patch);

  // Only these fields are part of the public AT record — see tierRecord()
  // and TierFields.containsAdultContent's doc comment on why that field is
  // excluded here.
  const hasAtChanges =
    patch.name !== undefined ||
    patch.description !== undefined ||
    patch.priceCents !== undefined ||
    patch.currency !== undefined ||
    patch.sortOrder !== undefined;
  const hasChanges = hasAtChanges || patch.containsAdultContent !== undefined;

  if (!hasChanges) {
    return tier;
  }

  const merged: TierFields = {
    name: patch.name ?? tier.name,
    description: patch.description ?? tier.description ?? undefined,
    priceCents: patch.priceCents ?? tier.priceCents,
    currency: patch.currency ?? tier.currency,
    sortOrder: patch.sortOrder ?? tier.sortOrder,
    containsAdultContent: patch.containsAdultContent ?? tier.containsAdultContent,
  };

  if (hasAtChanges) {
    try {
      await publishAtRecord(creatorDid, {
        collection: NSID.tier,
        rkey: tier.atRkey,
        record: tierRecord(merged, tier.createdAt),
      });
    } catch (error) {
      throw new AtRecordPublishError("Failed to publish subscription tier to the AT network.", error);
    }
  }

  return prisma.subscriptionTier.update({
    where: { id: tier.id },
    data: {
      name: merged.name,
      description: merged.description,
      priceCents: merged.priceCents,
      currency: merged.currency,
      sortOrder: merged.sortOrder,
      containsAdultContent: merged.containsAdultContent,
    },
  });
}

/**
 * Reactivates a deactivated tier: re-publishes the tier AT record (it was
 * deleted when the tier was deactivated) under the row's existing rkey and
 * flips isActive back on. The inverse of `deactivateTier`. Idempotent —
 * calling it on an already-active tier is a no-op and never re-publishes.
 */
export async function reactivateTier(
  prisma: PrismaClient,
  publishAtRecord: PublishAtRecord,
  tier: SubscriptionTier,
  creatorDid: string,
): Promise<SubscriptionTier> {
  if (tier.isActive) {
    return tier;
  }

  const fields: TierFields = {
    name: tier.name,
    description: tier.description ?? undefined,
    priceCents: tier.priceCents,
    currency: tier.currency,
    sortOrder: tier.sortOrder,
  };

  try {
    await publishAtRecord(creatorDid, {
      collection: NSID.tier,
      rkey: tier.atRkey,
      record: tierRecord(fields, tier.createdAt),
    });
  } catch (error) {
    throw new AtRecordPublishError("Failed to publish subscription tier to the AT network.", error);
  }

  return prisma.subscriptionTier.update({ where: { id: tier.id }, data: { isActive: true } });
}

/**
 * Deactivates a tier: deletes the tier AT record (it's no longer a public
 * offering) and flips isActive — the row itself is never deleted, so a
 * future Subscription (Phase 6) can still reference it. Calling this on an
 * already-inactive tier is a no-op (idempotent), and deliberately never
 * re-calls deleteAtRecord in that case — see packages/atproto's
 * deleteRecord doc comment on why double-delete isn't relied upon to be
 * safe against a real PDS.
 */
export async function deactivateTier(
  prisma: PrismaClient,
  deleteAtRecord: DeleteAtRecord,
  tier: SubscriptionTier,
  creatorDid: string,
): Promise<SubscriptionTier> {
  if (!tier.isActive) {
    return tier;
  }

  try {
    await deleteAtRecord(creatorDid, { collection: NSID.tier, rkey: tier.atRkey });
  } catch (error) {
    throw new AtRecordDeleteError("Failed to remove subscription tier from the AT network.", error);
  }

  return prisma.subscriptionTier.update({ where: { id: tier.id }, data: { isActive: false } });
}

export async function getOwnedTier(prisma: PrismaClient, creatorId: string, tierId: string): Promise<SubscriptionTier> {
  const tier = await prisma.subscriptionTier.findUnique({ where: { id: tierId } });
  if (!tier || tier.creatorId !== creatorId) {
    throw new TierNotFoundError("Tier not found.");
  }
  return tier;
}

export async function listActiveTiers(prisma: PrismaClient, creatorId: string): Promise<SubscriptionTier[]> {
  return prisma.subscriptionTier.findMany({
    where: { creatorId, isActive: true },
    orderBy: { sortOrder: "asc" },
  });
}

/**
 * Every tier the creator owns, active or not — the owner-facing counterpart
 * to `listActiveTiers` (which is what the public creator page sees). Used by
 * the tier-management UI so a creator can see and reactivate a tier they
 * previously deactivated.
 */
export async function listAllTiers(prisma: PrismaClient, creatorId: string): Promise<SubscriptionTier[]> {
  return prisma.subscriptionTier.findMany({
    where: { creatorId },
    orderBy: { sortOrder: "asc" },
  });
}
