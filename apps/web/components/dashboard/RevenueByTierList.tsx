import type { DashboardTierRevenue } from "@/lib/dashboard";
import { EmptyState } from "@/components/ui";
import { formatPrice } from "@/lib/tier";

/**
 * Revenue-by-tier breakdown as a ranked list with inline magnitude bars —
 * deliberately not a pie/donut (poor for more than 2-3 categories, per the
 * data-viz method's form guidance) and not a multi-series chart (there's
 * only ever one metric, revenue, split across a handful of tiers). One
 * brand hue for every bar: identity here is already carried by the tier
 * name label, not by color, so there's no categorical-hue assignment to
 * make.
 */
export function RevenueByTierList({ tiers }: { tiers: DashboardTierRevenue[] }) {
  if (tiers.length === 0) {
    return <EmptyState title="No tier revenue yet" description="Revenue by tier appears once a subscriber is on an active tier." />;
  }

  const maxCents = Math.max(...tiers.map((t) => t.monthlyRevenueCents));

  return (
    <ul className="space-y-3">
      {tiers.map((tier) => {
        const widthPct = maxCents > 0 ? Math.max((tier.monthlyRevenueCents / maxCents) * 100, 4) : 0;
        return (
          <li key={tier.tierId}>
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="truncate font-medium">
                {tier.tierName}
                {!tier.isActive && <span className="ml-1.5 text-xs font-normal text-muted">(retired)</span>}
              </span>
              <span className="shrink-0 tabular-nums text-muted">
                {formatPrice(tier.monthlyRevenueCents, tier.currency)} · {tier.activeSubscribers}{" "}
                {tier.activeSubscribers === 1 ? "subscriber" : "subscribers"}
              </span>
            </div>
            <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-surface-muted">
              <div className="h-full rounded-full bg-primary" style={{ width: `${widthPct}%` }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
