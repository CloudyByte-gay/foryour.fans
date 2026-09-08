/**
 * The domain must not be tightly coupled to a specific processor — see
 * prompts/full.md's Phase 6 note: Stripe cannot be assumed usable for a
 * platform that supports adult content, so this interface deliberately
 * avoids leaking Stripe-shaped concepts (PaymentIntents, Elements, etc).
 * It's built around a **hosted-checkout redirect** model instead — send the
 * subscriber to a provider-hosted page, get a webhook back — since that's
 * the integration shape most high-risk/adult-content-compatible processors
 * actually use, and it degrades gracefully to a provider that can respond
 * synchronously too (just omit `redirectUrl`).
 */

export interface CreateCustomerParams {
  userId: string;
  handle?: string;
}

export interface CreateCustomerResult {
  customerId: string;
}

export interface CreateSubscriptionParams {
  customerId: string;
  /** Our own tier id, passed through so a webhook can be matched back to it without a provider-side lookup. */
  tierId: string;
  priceCents: number;
  currency: string;
}

export interface CreateSubscriptionResult {
  status: "pending" | "active";
  providerSubscriptionId?: string;
  /** Present for hosted-checkout flows — the caller should redirect the browser here. */
  redirectUrl?: string;
}

export interface WebhookEvent {
  providerEventId: string;
  type: string;
  payload: unknown;
  /**
   * When the provider says this event actually happened (NOT when it was
   * delivered) — most real providers include this. Used to detect
   * out-of-order redelivery (packages/subscriptions/src/webhooks.ts): most
   * providers only guarantee at-least-once delivery, not ordering, so a
   * "past_due" event generated before a later "activated" event can still
   * arrive second. Optional — a provider that gives no ordering signal
   * falls back to applying events in arrival order, same as before this
   * field existed.
   */
  occurredAt?: Date;
}

export interface PaymentProvider {
  readonly name: string;
  createCustomer(params: CreateCustomerParams): Promise<CreateCustomerResult>;
  createSubscription(params: CreateSubscriptionParams): Promise<CreateSubscriptionResult>;
  cancelSubscription(providerSubscriptionId: string): Promise<void>;
  /** Verifies and parses a raw webhook delivery. Must be given the raw, unparsed body — signature verification on a real provider depends on the exact bytes, not a re-serialized JSON parse. */
  handleWebhook(rawBody: Buffer, headers: Record<string, string>): Promise<WebhookEvent>;
}

export type PayoutAccountProviderStatus = "pending" | "verified" | "restricted";

export interface CreateCreatorAccountParams {
  creatorId: string;
  creatorDid: string;
}

export interface CreateCreatorAccountResult {
  providerAccountId: string;
  /** Present for providers with a hosted onboarding flow (e.g. Stripe Connect-style). */
  onboardingUrl?: string;
}

export interface PayoutProvider {
  readonly name: string;
  createCreatorAccount(params: CreateCreatorAccountParams): Promise<CreateCreatorAccountResult>;
  getAccountStatus(providerAccountId: string): Promise<{ status: PayoutAccountProviderStatus }>;
}
