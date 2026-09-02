import type { Metadata } from "next";
import { fetchApi } from "@/lib/serverApi";
import type { ListedSubscription } from "@/lib/subscriptions";
import { SubscriptionList } from "./SubscriptionList";

export const metadata: Metadata = { title: "Subscriptions" };

export default async function SubscriptionsPage() {
  // The (app) layout guarantees a session. `GET /subscriptions` is always the
  // caller's own — ownership by construction.
  const res = await fetchApi("/subscriptions");
  if (!res.ok) {
    throw new Error(`Failed to load /subscriptions: ${res.status}`);
  }
  const subscriptions = (await res.json()) as ListedSubscription[];

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Subscriptions</h1>
        <p className="mt-1 text-muted">
          Creators you support. Each subscription keeps the price you signed up at.
        </p>
      </div>
      <SubscriptionList initialSubscriptions={subscriptions} />
    </div>
  );
}
