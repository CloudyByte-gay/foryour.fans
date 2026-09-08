-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN     "lastWebhookEventAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "subscriptions_creatorId_idx" ON "subscriptions"("creatorId");

-- AddForeignKey
ALTER TABLE "content_key_grants" ADD CONSTRAINT "content_key_grants_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Phase 15 (Production Hardening) — defense-in-depth CHECK constraints.
-- These mirror validation that already exists in application code
-- (packages/subscriptions/src/tiers.ts#validateTierFields,
-- packages/media/src/validation.ts) so a bug or a future direct-DB write
-- can never leave a negative/zero price or a non-positive byte count on a
-- row, not just today's application-layer check. Not expressible in
-- schema.prisma itself (Prisma 5.22 has no stable `@@check` yet), so this
-- is hand-written SQL rather than something `prisma migrate dev` would
-- regenerate on its own.
ALTER TABLE "subscription_tiers" ADD CONSTRAINT "subscription_tiers_priceCents_positive" CHECK ("priceCents" > 0);

ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_priceCentsAtSubscription_positive" CHECK ("priceCentsAtSubscription" > 0);

ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_size_positive" CHECK ("size" > 0);
