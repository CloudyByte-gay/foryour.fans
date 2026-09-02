import type { BadgeProps } from "@/components/ui";
import { apiFetch } from "@/lib/apiFetch";
import { csrfHeaders } from "@/lib/csrf";

/**
 * Client-safe subscription helpers, mirrored from the API's Phase 6 routes
 * (`apps/api/src/routes/subscriptions.ts`). No `next/headers` / server-only
 * imports here — imported by client components.
 *
 * The shape is dictated by the fake `PaymentProvider`
 * (`packages/subscriptions/src/providers/fakePaymentProvider.ts`), which is a
 * hosted-checkout model: `POST /creators/:id/subscribe` always returns a
 * PENDING subscription plus a `redirectUrl`; the row only becomes ACTIVE
 * after the provider's webhook fires. The browser therefore (a) navigates to
 * `redirectUrl`, and (b) on return, reconciles by re-reading
 * `GET /subscriptions` — there is no synchronous "you're subscribed" path.
 */

export type SubscriptionStatus = "PENDING" | "ACTIVE" | "PAST_DUE" | "CANCELED" | "EXPIRED";

/** `toOwnSubscription` in the API — also the `PATCH /subscriptions/:id` body. */
export interface OwnSubscription {
  id: string;
  creatorId: string;
  tierId: string;
  status: SubscriptionStatus;
  priceCentsAtSubscription: number;
  currencyAtSubscription: string;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  createdAt: string;
}

/** `POST /creators/:identifier/subscribe` response — an OwnSubscription plus the redirect. */
export interface SubscribeResult extends OwnSubscription {
  /** Present for the hosted-checkout flow (always, with the fake provider). */
  redirectUrl?: string | null;
}

/** `toListedSubscription` in the API — a row of `GET /subscriptions`. */
export interface ListedSubscription extends OwnSubscription {
  creator: { did: string; handle: string | null; displayName: string | null };
  tier: { id: string; name: string };
}

interface StatusMeta {
  label: string;
  badge: NonNullable<BadgeProps["variant"]>;
}

export const SUBSCRIPTION_STATUS_META: Record<SubscriptionStatus, StatusMeta> = {
  PENDING: { label: "Pending", badge: "warning" },
  ACTIVE: { label: "Active", badge: "success" },
  PAST_DUE: { label: "Past due", badge: "danger" },
  CANCELED: { label: "Canceled", badge: "neutral" },
  EXPIRED: { label: "Expired", badge: "neutral" },
};

/** A subscription in one of these states can be re-subscribed to (a brand-new row + price snapshot). */
export function isResubscribable(status: SubscriptionStatus): boolean {
  return status === "CANCELED" || status === "EXPIRED";
}

/** Only `active`/`past_due` subscriptions carry the cancel-at-period-end control. */
export function isCancelable(status: SubscriptionStatus): boolean {
  return status === "ACTIVE" || status === "PAST_DUE" || status === "PENDING";
}

interface ApiError {
  error?: { message?: string; statusCode?: number };
}

async function readApiError(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as ApiError | null;
  return body?.error?.message ?? fallback;
}

export type SubscribeOutcome =
  | { ok: true; result: SubscribeResult }
  | { ok: false; code: "already_subscribed" | "unavailable" | "error"; message: string };

/**
 * `POST /creators/:identifier/subscribe`. `identifier` is the creator's AT
 * handle or DID (the same segment `/c/:identifier` uses).
 */
export async function subscribeToTier(identifier: string, tierId: string): Promise<SubscribeOutcome> {
  let res: Response;
  try {
    res = await apiFetch(`/creators/${encodeURIComponent(identifier)}/subscribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...csrfHeaders() },
      body: JSON.stringify({ tierId }),
    });
  } catch {
    return { ok: false, code: "error", message: "Something went wrong. Please try again." };
  }

  if (res.status === 201) {
    return { ok: true, result: (await res.json()) as SubscribeResult };
  }
  if (res.status === 409) {
    return {
      ok: false,
      code: "already_subscribed",
      message: "You already have a subscription to this creator.",
    };
  }
  if (res.status === 404) {
    return { ok: false, code: "unavailable", message: "That tier isn't available anymore." };
  }
  return { ok: false, code: "error", message: await readApiError(res, "Couldn't start the subscription.") };
}

/** `PATCH /subscriptions/:id` — toggles whether the subscription lapses at the period end. */
export async function setCancelAtPeriodEnd(
  subscriptionId: string,
  cancelAtPeriodEnd: boolean,
): Promise<{ ok: true; subscription: OwnSubscription } | { ok: false; message: string }> {
  let res: Response;
  try {
    res = await apiFetch(`/subscriptions/${subscriptionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...csrfHeaders() },
      body: JSON.stringify({ cancelAtPeriodEnd }),
    });
  } catch {
    return { ok: false, message: "Something went wrong. Please try again." };
  }
  if (!res.ok) {
    return { ok: false, message: await readApiError(res, "Couldn't update the subscription.") };
  }
  return { ok: true, subscription: (await res.json()) as OwnSubscription };
}

/** `GET /subscriptions` — the caller's own subscriptions, newest first. */
export async function listOwnSubscriptions(): Promise<ListedSubscription[]> {
  const res = await apiFetch("/subscriptions");
  if (!res.ok) {
    throw new Error(`GET /subscriptions failed: ${res.status}`);
  }
  return (await res.json()) as ListedSubscription[];
}

const RETURN_CONTEXT_KEY = "ff.subscribeReturn";

export interface SubscribeReturnContext {
  /** The creator page to link back to once the subscription resolves. */
  address: string;
  creatorName: string;
  subscriptionId: string;
}

/** Stashed before navigating to the hosted checkout; read on `/subscribe/return`. */
export function stashSubscribeReturn(context: SubscribeReturnContext): void {
  try {
    window.sessionStorage.setItem(RETURN_CONTEXT_KEY, JSON.stringify(context));
  } catch {
    // sessionStorage unavailable — /subscribe/return falls back to the newest row.
  }
}

export function takeSubscribeReturn(): SubscribeReturnContext | null {
  try {
    const raw = window.sessionStorage.getItem(RETURN_CONTEXT_KEY);
    window.sessionStorage.removeItem(RETURN_CONTEXT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SubscribeReturnContext;
    if (typeof parsed?.address === "string" && typeof parsed?.subscriptionId === "string") {
      return parsed;
    }
  } catch {
    // ignore
  }
  return null;
}
