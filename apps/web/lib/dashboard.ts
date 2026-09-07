import { apiFetch } from "@/lib/apiFetch";
import type { PostVisibility } from "@/lib/post";

/**
 * Client-safe types + helpers for `/creator/dashboard` (WEB PHASE 13),
 * mirroring `GET /creators/me/dashboard`
 * (apps/api/src/routes/dashboard.ts / packages/subscriptions/src/dashboard.ts).
 * Revenue figures always come from the billing DB — never AT Protocol — and
 * use each subscriber's price snapshot, never a tier's live price.
 */

export interface DashboardTierRevenue {
  tierId: string;
  tierName: string;
  isActive: boolean;
  activeSubscribers: number;
  monthlyRevenueCents: number;
  currency: string;
}

export interface DashboardTimeSeriesPoint {
  /** UTC calendar day, `YYYY-MM-DD`. */
  date: string;
  newSubscribers: number;
  cancellations: number;
  activeSubscriptions: number;
  mrrCents: number;
}

export interface DashboardRecentPost {
  id: string;
  visibility: PostVisibility;
  text: string;
  mediaCount: number;
  createdAt: string;
}

export type PayoutAccountStatus = "NOT_STARTED" | "PENDING" | "VERIFIED" | "RESTRICTED";

export interface CreatorDashboard {
  range: { start: string; end: string };
  currency: string;
  subscriberCount: number;
  activeSubscriptions: number;
  mrrCents: number;
  revenueByTier: DashboardTierRevenue[];
  newSubscribers: number;
  cancellations: number;
  timeSeries: DashboardTimeSeriesPoint[];
  payout: { status: PayoutAccountStatus; provider: string | null } | null;
  recentPosts: DashboardRecentPost[];
}

export type DashboardRangePreset = "7d" | "30d" | "90d" | "custom";

export interface DashboardRangeQuery {
  from: string;
  to: string;
}

const PRESET_DAYS: Record<Exclude<DashboardRangePreset, "custom">, number> = { "7d": 7, "30d": 30, "90d": 90 };
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** `{from, to}` (both `YYYY-MM-DD`, inclusive) for a preset, ending "today". */
export function presetRange(preset: Exclude<DashboardRangePreset, "custom">, now: Date = new Date()): DashboardRangeQuery {
  const days = PRESET_DAYS[preset];
  return { from: isoDate(new Date(now.getTime() - (days - 1) * MS_PER_DAY)), to: isoDate(now) };
}

export const DEFAULT_DASHBOARD_PRESET: Exclude<DashboardRangePreset, "custom"> = "30d";

export function dashboardPresetLabel(preset: DashboardRangePreset): string {
  switch (preset) {
    case "7d":
      return "Last 7 days";
    case "30d":
      return "Last 30 days";
    case "90d":
      return "Last 90 days";
    case "custom":
      return "Custom";
  }
}

export async function fetchDashboard(range: DashboardRangeQuery): Promise<CreatorDashboard> {
  const qs = new URLSearchParams({ from: range.from, to: range.to });
  const res = await apiFetch(`/creators/me/dashboard?${qs.toString()}`);
  if (!res.ok) {
    throw new Error(`Failed to load dashboard: ${res.status}`);
  }
  return (await res.json()) as CreatorDashboard;
}

/** Whether this creator has done essentially nothing yet — drives the onboarding-guidance panel. */
export function isNewCreator(dashboard: CreatorDashboard, tiersCount: number): boolean {
  return (
    tiersCount === 0 &&
    dashboard.recentPosts.length === 0 &&
    dashboard.subscriberCount === 0 &&
    dashboard.newSubscribers === 0
  );
}
