import type { PrismaClient, SubscriptionStatus } from "@foryour-fans/database";
import type { PaymentProvider } from "./providers/types.js";

export class InvalidWebhookError extends Error {
  constructor(
    message: string,
    readonly cause: unknown,
  ) {
    super(message);
  }
}

export type WebhookOutcome = "processed" | "duplicate" | "ignored" | "stale";

/**
 * Maps a fake-provider event type to a Subscription status transition.
 * Real providers will have their own event vocabulary — this mapping is
 * expected to grow/change per-provider once one is actually chosen; kept
 * as a plain function (not provider-owned) so it's easy to see and adjust
 * without reaching into provider internals.
 *
 * Phase 15 (Production Hardening) added `payment.failed` and
 * `payment.refunded`: a real provider's "the card was declined" and "we
 * clawed the money back" events are distinct from the subscription
 * lifecycle events above, but both still need to change access immediately
 * — a failed charge the same way an already-past-due subscription does
 * (PAST_DUE — canAccess denies non-ACTIVE, see entitlements.ts), and a
 * refund by revoking access outright (CANCELED), never leaving a refunded
 * subscriber with paid access until the period they were refunded for ends.
 */
function statusForEventType(type: string): SubscriptionStatus | null {
  switch (type) {
    case "subscription.activated":
      return "ACTIVE";
    case "subscription.past_due":
    case "payment.failed":
      return "PAST_DUE";
    case "subscription.canceled":
    case "payment.refunded":
      return "CANCELED";
    default:
      return null;
  }
}

/**
 * The idempotent webhook entry point: verifies+parses the delivery via the
 * provider (so an invalid signature never reaches this far), records it in
 * PaymentEvent keyed by [provider, providerEventId] BEFORE applying any
 * side effect, and short-circuits on a second delivery of an
 * already-`processedAt`-set event — so replaying the same event twice has
 * exactly one effect, per prompts/full.md's Phase 6 requirement.
 *
 * A row that exists but has `processedAt: null` (a prior attempt crashed
 * mid-processing) is NOT treated as a duplicate — processing resumes for
 * it, since the side effect never actually completed.
 */
export async function processWebhookEvent(
  prisma: PrismaClient,
  paymentProvider: PaymentProvider,
  rawBody: Buffer,
  headers: Record<string, string>,
): Promise<WebhookOutcome> {
  let event;
  try {
    event = await paymentProvider.handleWebhook(rawBody, headers);
  } catch (error) {
    throw new InvalidWebhookError("Webhook verification/parsing failed.", error);
  }

  const existing = await prisma.paymentEvent.findUnique({
    where: { provider_providerEventId: { provider: paymentProvider.name, providerEventId: event.providerEventId } },
  });
  if (existing?.processedAt) {
    return "duplicate";
  }

  const eventRow =
    existing ??
    (await prisma.paymentEvent.create({
      data: {
        provider: paymentProvider.name,
        providerEventId: event.providerEventId,
        type: event.type,
        payload: event.payload as object,
      },
    }));

  const outcome = await applySubscriptionSideEffect(prisma, paymentProvider.name, event.type, event.payload, event.occurredAt);

  await prisma.paymentEvent.update({ where: { id: eventRow.id }, data: { processedAt: new Date() } });

  return outcome;
}

async function applySubscriptionSideEffect(
  prisma: PrismaClient,
  provider: string,
  type: string,
  payload: unknown,
  occurredAt: Date | undefined,
): Promise<WebhookOutcome> {
  const newStatus = statusForEventType(type);
  if (!newStatus) return "ignored";

  const data = (payload as { data?: { providerSubscriptionId?: string } }).data;
  const providerSubscriptionId = data?.providerSubscriptionId;
  if (!providerSubscriptionId) return "ignored";

  const subscription = await prisma.subscription.findUnique({
    where: { provider_providerSubscriptionId: { provider, providerSubscriptionId } },
  });
  if (!subscription) return "ignored";

  // Out-of-order redelivery guard: most providers only guarantee
  // at-least-once delivery, not ordering — a "past_due" generated before a
  // later "activated" can still arrive second. Only compare when BOTH sides
  // carry a real timestamp; if either is missing, apply as before (arrival
  // order), which is exactly today's behavior for a provider that gives no
  // ordering signal at all.
  if (occurredAt && subscription.lastWebhookEventAt && occurredAt < subscription.lastWebhookEventAt) {
    return "stale";
  }

  const periodFields =
    newStatus === "ACTIVE"
      ? { currentPeriodStart: new Date(), currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) }
      : {};

  await prisma.subscription.update({
    where: { id: subscription.id },
    data: { status: newStatus, ...periodFields, ...(occurredAt ? { lastWebhookEventAt: occurredAt } : {}) },
  });

  return "processed";
}
