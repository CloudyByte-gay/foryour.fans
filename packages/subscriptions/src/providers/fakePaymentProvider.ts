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
export class FakePaymentProvider implements PaymentProvider {
  readonly name = "fake";

  async createCustomer(params: CreateCustomerParams): Promise<CreateCustomerResult> {
    void params;
    return { customerId: `fake_cust_${randomUUID()}` };
  }

  async createSubscription(params: CreateSubscriptionParams): Promise<CreateSubscriptionResult> {
    const providerSubscriptionId = `fake_sub_${randomUUID()}`;
    return {
      status: "pending",
      providerSubscriptionId,
      redirectUrl: `https://fake-checkout.example/session/${providerSubscriptionId}?tier=${params.tierId}`,
    };
  }

  async cancelSubscription(providerSubscriptionId: string): Promise<void> {
    void providerSubscriptionId;
    // No real side effect to simulate — cancellation is driven by our own
    // Subscription.status update; a real provider call would happen here.
  }

  async handleWebhook(rawBody: Buffer, headers: Record<string, string>): Promise<WebhookEvent> {
    void headers; // a real provider would verify a signature header against rawBody here
    const payload = JSON.parse(rawBody.toString("utf8")) as { id: string; type: string; [key: string]: unknown };
    return { providerEventId: payload.id, type: payload.type, payload };
  }
}

export type FakeWebhookType = "subscription.activated" | "subscription.past_due" | "subscription.canceled";

/**
 * Test/dev-only helper for constructing a fake webhook delivery — the raw
 * bytes + headers a real PaymentProvider.handleWebhook would receive over
 * HTTP, so tests exercise the exact same code path production traffic
 * would hit (see apps/api/src/routes/subscriptions.ts's raw-body content
 * parser on the webhook route).
 */
export function fakeWebhookDelivery(
  type: FakeWebhookType,
  providerSubscriptionId: string,
  options: { eventId?: string } = {},
): { rawBody: Buffer; headers: Record<string, string> } {
  const payload = {
    id: options.eventId ?? `evt_${randomUUID()}`,
    type,
    data: { providerSubscriptionId },
  };
  return {
    rawBody: Buffer.from(JSON.stringify(payload), "utf8"),
    headers: { "content-type": "application/json" },
  };
}
