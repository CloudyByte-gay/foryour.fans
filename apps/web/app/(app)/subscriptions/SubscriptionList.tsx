"use client";

import { AlertTriangle, Compass } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  Switch,
  toast,
} from "@/components/ui";
import { shortDate } from "@/lib/format";
import {
  SUBSCRIPTION_STATUS_META,
  isCancelable,
  isResubscribable,
  setCancelAtPeriodEnd,
  type ListedSubscription,
} from "@/lib/subscriptions";
import { formatPrice } from "@/lib/tier";

export function SubscriptionList({
  initialSubscriptions,
}: {
  initialSubscriptions: ListedSubscription[];
}) {
  const [subscriptions, setSubscriptions] = useState(initialSubscriptions);

  if (subscriptions.length === 0) {
    return (
      <EmptyState
        icon={Compass}
        title="No subscriptions yet"
        description="When you subscribe to a creator, it shows up here — with the price you locked in and the renewal date."
        action={
          <Button asChild size="sm">
            <Link href="/discover">Find creators</Link>
          </Button>
        }
      />
    );
  }

  function patch(next: ListedSubscription) {
    setSubscriptions((prev) => prev.map((s) => (s.id === next.id ? next : s)));
  }

  return (
    <ul className="space-y-3">
      {subscriptions.map((subscription) => (
        <li key={subscription.id}>
          <SubscriptionRow subscription={subscription} onPatched={patch} />
        </li>
      ))}
    </ul>
  );
}

function SubscriptionRow({
  subscription,
  onPatched,
}: {
  subscription: ListedSubscription;
  onPatched: (next: ListedSubscription) => void;
}) {
  const [busy, setBusy] = useState(false);
  const meta = SUBSCRIPTION_STATUS_META[subscription.status];
  const address = subscription.creator.handle ?? subscription.creator.did;
  const creatorName = subscription.creator.displayName ?? `@${address}`;
  const price = formatPrice(subscription.priceCentsAtSubscription, subscription.currencyAtSubscription);
  const periodEnd = subscription.currentPeriodEnd ? shortDate(subscription.currentPeriodEnd) : null;

  async function onToggleCancel(cancelAtPeriodEnd: boolean) {
    setBusy(true);
    const previous = subscription;
    onPatched({ ...subscription, cancelAtPeriodEnd }); // optimistic
    const outcome = await setCancelAtPeriodEnd(subscription.id, cancelAtPeriodEnd);
    setBusy(false);
    if (!outcome.ok) {
      onPatched(previous); // revert
      toast({ title: "Couldn't update the subscription", description: outcome.message, variant: "error" });
      return;
    }
    onPatched({ ...previous, ...outcome.subscription });
    toast({
      title: cancelAtPeriodEnd ? "Set to cancel at renewal" : "Subscription will keep renewing",
      description:
        cancelAtPeriodEnd && periodEnd
          ? `You keep access until ${periodEnd}.`
          : undefined,
    });
  }

  let timing: string | null = null;
  if (subscription.status === "ACTIVE") {
    timing = subscription.cancelAtPeriodEnd
      ? periodEnd
        ? `Cancels — access until ${periodEnd}`
        : "Cancels at the end of the current period"
      : periodEnd
        ? `Renews ${periodEnd}`
        : "Renews monthly";
  } else if (subscription.status === "PENDING") {
    timing = "Waiting for payment confirmation";
  } else if (subscription.status === "CANCELED" || subscription.status === "EXPIRED") {
    timing = periodEnd ? `Access ended ${periodEnd}` : "Ended";
  }

  return (
    <Card>
      <CardContent className="space-y-3 py-4">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
          <div className="min-w-0">
            <Link href={`/c/${address}`} className="font-medium hover:underline">
              {creatorName}
            </Link>
            <p className="text-sm text-muted">
              {subscription.tier.name} · {price} / month
            </p>
          </div>
          <Badge variant={meta.badge}>{meta.label}</Badge>
        </div>

        {timing && <p className="text-sm text-muted">{timing}</p>}

        {subscription.status === "PAST_DUE" && (
          <div className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/5 p-3 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden />
            <div className="space-y-1">
              <p className="font-medium text-foreground">Your last payment failed</p>
              <p className="text-muted">
                Access is paused until it&rsquo;s resolved. You&rsquo;ll be able to update your
                payment method here — the secure payment portal for this isn&rsquo;t wired up yet.
              </p>
              <Button size="sm" variant="secondary" disabled className="mt-1">
                Update payment method
              </Button>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-1">
          {isCancelable(subscription.status) && (
            <label className="flex items-center gap-2 text-sm text-muted">
              <Switch
                checked={subscription.cancelAtPeriodEnd}
                disabled={busy}
                onCheckedChange={onToggleCancel}
                aria-label={`Cancel ${creatorName} at renewal`}
              />
              <span>Cancel at renewal</span>
            </label>
          )}
          {isResubscribable(subscription.status) && (
            <Button asChild size="sm" variant="secondary">
              <Link href={`/c/${address}`}>Resubscribe</Link>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
