"use client";

import { useCallback, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, ErrorState } from "@/components/ui";
import { cn } from "@/lib/cn";
import { formatPrice } from "@/lib/tier";
import {
  DEFAULT_DASHBOARD_PRESET,
  fetchDashboard,
  isNewCreator,
  type CreatorDashboard,
  type DashboardRangePreset,
  type DashboardRangeQuery,
} from "@/lib/dashboard";
import { DateRangeFilter } from "@/components/dashboard/DateRangeFilter";
import { StatTile } from "@/components/dashboard/StatTile";
import { TimeSeriesChart } from "@/components/dashboard/TimeSeriesChart";
import { RevenueByTierList } from "@/components/dashboard/RevenueByTierList";
import { RecentPostsList } from "@/components/dashboard/RecentPostsList";
import { PayoutGate } from "@/components/dashboard/PayoutGate";
import { NewCreatorGuidance } from "@/components/dashboard/NewCreatorGuidance";

export function DashboardClient({
  pageAddress,
  initialRange,
  initialDashboard,
  tiersCount,
}: {
  pageAddress: string;
  initialRange: DashboardRangeQuery;
  initialDashboard: CreatorDashboard;
  tiersCount: number;
}) {
  const [preset, setPreset] = useState<DashboardRangePreset>(DEFAULT_DASHBOARD_PRESET);
  const [range, setRange] = useState<DashboardRangeQuery>(initialRange);
  const [dashboard, setDashboard] = useState<CreatorDashboard>(initialDashboard);
  const [status, setStatus] = useState<"ready" | "loading" | "error">("ready");
  const requestId = useRef(0);

  const load = useCallback(async (nextRange: DashboardRangeQuery) => {
    const id = ++requestId.current;
    setStatus("loading");
    try {
      const next = await fetchDashboard(nextRange);
      if (id !== requestId.current) return;
      setDashboard(next);
      setStatus("ready");
    } catch {
      if (id !== requestId.current) return;
      setStatus("error");
    }
  }, []);

  const handleRangeChange = useCallback(
    (nextPreset: DashboardRangePreset, nextRange: DashboardRangeQuery) => {
      setPreset(nextPreset);
      setRange(nextRange);
      void load(nextRange);
    },
    [load],
  );

  const showGuidance = isNewCreator(dashboard, tiersCount);
  const payoutStatus = dashboard.payout?.status ?? "NOT_STARTED";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-bold tracking-tight">Dashboard</h1>
        <DateRangeFilter preset={preset} range={range} onChange={handleRangeChange} />
      </div>

      {showGuidance && (
        <NewCreatorGuidance
          hasPost={dashboard.recentPosts.length > 0}
          hasTier={tiersCount > 0}
          payoutVerified={payoutStatus === "VERIFIED"}
        />
      )}

      {status === "error" ? (
        <ErrorState message="We couldn't load your dashboard for that range." onRetry={() => void load(range)} />
      ) : (
        <div className={cn("space-y-6 transition-opacity", status === "loading" && "pointer-events-none opacity-60")} aria-busy={status === "loading"}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label="Subscribers" value={dashboard.subscriberCount} hint="Right now" />
            <StatTile label="Active subscriptions" value={dashboard.activeSubscriptions} hint="Billing successfully" />
            <StatTile label="New subscribers" value={dashboard.newSubscribers} hint="In range" />
            <StatTile label="Cancellations" value={dashboard.cancellations} hint="In range" />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Revenue</CardTitle>
            </CardHeader>
            <CardContent>
              <PayoutGate status={payoutStatus}>
                <div className="space-y-6">
                  <StatTile
                    label="Monthly recurring revenue"
                    value={formatPrice(dashboard.mrrCents, dashboard.currency)}
                    className="max-w-xs"
                  />
                  <RevenueByTierList tiers={dashboard.revenueByTier} />
                </div>
              </PayoutGate>
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Subscribers over time</CardTitle>
              </CardHeader>
              <CardContent>
                <TimeSeriesChart
                  data={dashboard.timeSeries}
                  dataKey="activeSubscriptions"
                  formatValue={(v) => String(v)}
                  ariaLabel="Subscribers over time"
                />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>MRR over time</CardTitle>
              </CardHeader>
              <CardContent>
                <PayoutGate status={payoutStatus}>
                  <TimeSeriesChart
                    data={dashboard.timeSeries}
                    dataKey="mrrCents"
                    formatValue={(v) => formatPrice(v, dashboard.currency)}
                    ariaLabel="Monthly recurring revenue over time"
                  />
                </PayoutGate>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Recent posts</CardTitle>
            </CardHeader>
            <CardContent>
              <RecentPostsList posts={dashboard.recentPosts} pageAddress={pageAddress} />
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
