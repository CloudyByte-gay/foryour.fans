import { randomUUID } from "node:crypto";
import type { CreateCustomerParams, CreateCustomerResult, CreateSubscriptionParams, CreateSubscriptionResult, PaymentProvider, WebhookEvent } from "./types.js";

/**
 * The only PaymentProvider implementation that exists right now — used for
 * both local development and automated tests, per prompts/full.md's Phase 6
 * instruction. Modeled on a hosted-checkout flow (see types.ts): every
 * subscription starts "pending" with a fake redirect URL, and only becomes
 * "active" once a webhook confirms it — so the idempotency-critical webhook
 * path actually gets exercised, not bypassed for convenience.
 */
export interface FakePaymentProviderOptions {
  /**
   * Base URL the hosted-checkout `redirectUrl` is built from. Defaults to a
   * deliberately unreachable `https://fake-checkout.example` so nothing in a
   * unit test accidentally depends on it resolving. Point it at a reachable
   * stub (e.g. the apps/web Playwright fake API's `/__e2e__/checkout` route,
   * or a local dev stub) to actually click through the redirect.
   */
  checkoutBaseUrl?: string;
}

export class FakePaymentProvider implements PaymentProvider {
  readonly name = "fake";
  private readonly checkoutBaseUrl: string;

  constructor(options: FakePaymentProviderOptions = {}) {
    this.checkoutBaseUrl = (options.checkoutBaseUrl ?? "https://fake-checkout.example").replace(/\/+$/, "");
  }

  async createCustomer(params: CreateCustomerParams): Promise<CreateCustomerResult> {
    void params;
    return { customerId: `fake_cust_${randomUUID()}` };
  }

  async createSubscription(params: CreateSubscriptionParams): Promise<CreateSubscriptionResult> {
    const providerSubscriptionId = `fake_sub_${randomUUID()}`;
    return {
      status: "pending",
      providerSubscriptionId,
      redirectUrl: `${this.checkoutBaseUrl}/session/${providerSubscriptionId}?tier=${params.tierId}`,
    };
  }

  async cancelSubscription(providerSubscriptionId: string): Promise<void> {
    void providerSubscriptionId;
    // No real side effect to simulate — cancellation is driven by our own
    // Subscription.status update; a real provider call would happen here.
  }

  async handleWebhook(rawBody: Buffer, headers: Record<string, string>): Promise<WebhookEvent> {
    void headers; // a real provider would verify a signature header against rawBody here
    const payload = JSON.parse(rawBody.toString("utf8")) as {
      id: string;
      type: string;
      occurredAt?: string;
      [key: string]: unknown;
    };
    return {
      providerEventId: payload.id,
      type: payload.type,
      payload,
      occurredAt: payload.occurredAt ? new Date(payload.occurredAt) : undefined,
    };
  }
}

export type FakeWebhookType =
  | "subscription.activated"
  | "subscription.past_due"
  | "subscription.canceled"
  | "payment.failed"
  | "payment.refunded";

/**
 * Test/dev-only helper for constructing a fake webhook delivery — the raw
 * bytes + headers a real PaymentProvider.handleWebhook would receive over
 * HTTP, so tests exercise the exact same code path production traffic
 * would hit (see apps/api/src/routes/subscriptions.ts's raw-body content
 * parser on the webhook route). `occurredAt`, when given, lets a test
 * simulate an out-of-order redelivery — see webhooks.ts's staleness check.
 */
export function fakeWebhookDelivery(
  type: FakeWebhookType,
  providerSubscriptionId: string,
  options: { eventId?: string; occurredAt?: Date } = {},
): { rawBody: Buffer; headers: Record<string, string> } {
  const payload = {
    id: options.eventId ?? `evt_${randomUUID()}`,
    type,
    data: { providerSubscriptionId },
    ...(options.occurredAt ? { occurredAt: options.occurredAt.toISOString() } : {}),
  };
  return {
    rawBody: Buffer.from(JSON.stringify(payload), "utf8"),
    headers: { "content-type": "application/json" },
  };
}
