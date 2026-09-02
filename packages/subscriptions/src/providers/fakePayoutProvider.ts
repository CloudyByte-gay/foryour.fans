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
export interface FakePayoutProviderOptions {
  /**
   * Base URL the hosted-onboarding `onboardingUrl` is built from. Defaults to
   * a deliberately unreachable `https://fake-payouts.example`. Point it at a
   * reachable stub (e.g. the apps/web Playwright fake API's
   * `/__e2e__/payout-onboarding` route) to click through the redirect.
   */
  onboardingBaseUrl?: string;
}

export class FakePayoutProvider implements PayoutProvider {
  readonly name = "fake";
  private readonly onboardingBaseUrl: string;

  constructor(options: FakePayoutProviderOptions = {}) {
    this.onboardingBaseUrl = (options.onboardingBaseUrl ?? "https://fake-payouts.example").replace(/\/+$/, "");
  }

  async createCreatorAccount(params: CreateCreatorAccountParams): Promise<CreateCreatorAccountResult> {
    const providerAccountId = `fake_acct_${randomUUID()}`;
    return {
      providerAccountId,
      onboardingUrl: `${this.onboardingBaseUrl}/onboarding/${providerAccountId}?creator=${params.creatorId}`,
    };
  }

  async getAccountStatus(providerAccountId: string): Promise<{ status: PayoutAccountProviderStatus }> {
    void providerAccountId;
    return { status: "pending" };
  }
}
