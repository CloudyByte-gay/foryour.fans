import type { Creator, PayoutAccount, PayoutAccountStatus, PrismaClient } from "@foryour-fans/database";
import type { PayoutAccountProviderStatus, PayoutProvider } from "./providers/types.js";

export interface StartPayoutOnboardingResult {
  payoutAccount: PayoutAccount;
  onboardingUrl?: string;
}

/**
 * Idempotent: a creator who already started onboarding gets their existing
 * account back rather than a second one — FakePayoutProvider (and most real
 * ones) has no "create a second account for the same creator" concept
 * worth supporting.
 */
export async function startPayoutOnboarding(
  prisma: PrismaClient,
  payoutProvider: PayoutProvider,
  creator: Creator,
): Promise<StartPayoutOnboardingResult> {
  const existing = await prisma.payoutAccount.findUnique({ where: { creatorId: creator.id } });
  if (existing) {
    return { payoutAccount: existing };
  }

  const result = await payoutProvider.createCreatorAccount({ creatorId: creator.id, creatorDid: creator.did });

  const payoutAccount = await prisma.payoutAccount.create({
    data: {
      creatorId: creator.id,
      provider: payoutProvider.name,
      providerAccountId: result.providerAccountId,
      status: "PENDING",
    },
  });

  return { payoutAccount, onboardingUrl: result.onboardingUrl };
}

function mapProviderStatus(status: PayoutAccountProviderStatus): PayoutAccountStatus {
  switch (status) {
    case "verified":
      return "VERIFIED";
    case "restricted":
      return "RESTRICTED";
    case "pending":
      return "PENDING";
  }
}

/**
 * Live-checks status with the provider on every call rather than relying
 * on a webhook — no payout status webhook exists yet (prompts/full.md's
 * Phase 6 only specifies `getAccountStatus`, a poll, not a push), so this
 * IS the mechanism, matching the spec literally.
 */
export async function getPayoutAccountStatus(
  prisma: PrismaClient,
  payoutProvider: PayoutProvider,
  creatorId: string,
): Promise<PayoutAccount | null> {
  const account = await prisma.payoutAccount.findUnique({ where: { creatorId } });
  if (!account || !account.providerAccountId) {
    return account;
  }

  const live = await payoutProvider.getAccountStatus(account.providerAccountId);
  const mappedStatus = mapProviderStatus(live.status);
  if (mappedStatus === account.status) {
    return account;
  }

  return prisma.payoutAccount.update({ where: { id: account.id }, data: { status: mappedStatus } });
}
