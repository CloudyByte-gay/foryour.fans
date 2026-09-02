import { randomUUID } from "node:crypto";
import type { CreateCreatorAccountParams, CreateCreatorAccountResult, PayoutAccountProviderStatus, PayoutProvider } from "./types.js";

/**
 * The only PayoutProvider implementation that exists right now — see
 * FakePaymentProvider's doc comment for why. Accounts start "pending" (a
 * real payout provider always requires some verification step) and never
 * transition on their own — packages/subscriptions doesn't ship a route to
 * flip this in dev/test because there's nothing to flip it *to* yet
 * ("verified" would require a real provider's actual verification flow);
 * status is checked with `getAccountStatus`, exactly as a real integration
 * would.
 */
export class FakePayoutProvider implements PayoutProvider {
  readonly name = "fake";

  async createCreatorAccount(params: CreateCreatorAccountParams): Promise<CreateCreatorAccountResult> {
    const providerAccountId = `fake_acct_${randomUUID()}`;
    return {
      providerAccountId,
      onboardingUrl: `https://fake-payouts.example/onboarding/${providerAccountId}?creator=${params.creatorId}`,
    };
  }

  async getAccountStatus(providerAccountId: string): Promise<{ status: PayoutAccountProviderStatus }> {
    void providerAccountId;
    return { status: "pending" };
  }
}
