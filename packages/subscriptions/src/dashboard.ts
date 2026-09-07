import type { Creator, PrismaClient, SubscriptionStatus } from "@foryour-fans/database";

const ACTIVE_ISH_STATUSES: SubscriptionStatus[] = ["PENDING", "ACTIVE", "PAST_DUE"];
const ENDED_STATUSES: SubscriptionStatus[] = ["CANCELED", "EXPIRED"];

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MAX_RANGE_DAYS = 366;

export class DashboardRangeError extends Error {}

export interface DashboardRange {
  start: Date;
  end: Date;
}

/**
 * Normalizes a caller-supplied `[start, end]` into UTC day boundaries
 * (`start` at 00:00:00.000, `end` at 23:59:59.999) so "new subscribers" /
 * "cancellations" counts and the daily time series have unambiguous,
 * non-overlapping buckets regardless of what time of day the request lands.
 */
export function normalizeDashboardRange(start: Date, end: Date): DashboardRange {
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new DashboardRangeError("Invalid date range.");
  }
  if (start > end) {
    throw new DashboardRangeError("Range start must not be after range end.");
  }
  const normalizedStart = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const normalizedEnd = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate(), 23, 59, 59, 999));
  if (normalizedEnd.getTime() - normalizedStart.getTime() > MAX_RANGE_DAYS * MS_PER_DAY) {
    throw new DashboardRangeError(`Range must not exceed ${MAX_RANGE_DAYS} days.`);
  }
  return { start: normalizedStart, end: normalizedEnd };
}

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

export interface CreatorDashboard {
  range: { start: string; end: string };
  /** The dominant currency across this creator's active subscriptions (mode), falling back to their cheapest active tier, then "usd". Real multi-currency-per-creator aggregation is a documented gap — see docs/architecture.md's Phase 13 section. */
  currency: string;
  /** Subscribers currently in good standing or recovering from a failed charge (PENDING/ACTIVE/PAST_DUE) — "how many people are subscribed right now". */
  subscriberCount: number;
  /** Subscriptions currently billing successfully (status ACTIVE only) — excludes PAST_DUE, unlike subscriberCount. */
  activeSubscriptions: number;
  /** Sum of `priceCentsAtSubscription` over ACTIVE subscriptions only — the price each subscriber actually agreed to, never a tier's live price (see SubscriptionTier's grandfathering rule). */
  mrrCents: number;
  /** ACTIVE subscriptions grouped by tier, tiers with zero active subscribers omitted, sorted by revenue descending. */
  revenueByTier: DashboardTierRevenue[];
  /** Subscriptions (any status) created within `range`. */
  newSubscribers: number;
  /** Subscriptions whose status is CANCELED and whose last update fell within `range` — see the module doc comment on why this is an approximation. */
  cancellations: number;
  timeSeries: DashboardTimeSeriesPoint[];
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function enumerateDays(range: DashboardRange): Array<{ start: Date; end: Date }> {
  const days: Array<{ start: Date; end: Date }> = [];
  let cursor = new Date(range.start);
  while (cursor <= range.end) {
    const dayEnd = new Date(Math.min(cursor.getTime() + MS_PER_DAY - 1, range.end.getTime()));
    days.push({ start: cursor, end: dayEnd });
    cursor = new Date(cursor.getTime() + MS_PER_DAY);
  }
  return days;
}

function pickDominantCurrency(currencies: string[], fallback: string): string {
  if (currencies.length === 0) return fallback;
  const counts = new Map<string, number>();
  for (const currency of currencies) {
    counts.set(currency, (counts.get(currency) ?? 0) + 1);
  }
  let best = currencies[0]!;
  let bestCount = 0;
  for (const [currency, count] of counts) {
    if (count > bestCount) {
      best = currency;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Everything `GET /creators/me/dashboard` (prompts/full.md PHASE 13) needs,
 * computed entirely from the billing database — never from AT Protocol
 * records, per that phase's explicit requirement (see SubscriptionTier /
 * Subscription's own doc comments on price snapshotting). `subscriberCount`,
 * `activeSubscriptions`, `mrrCents`, and `revenueByTier` are always a
 * right-now snapshot: a "monthly recurring revenue" figure computed against
 * a past date wouldn't mean anything different from today's, so `range` only
 * bounds `newSubscribers`, `cancellations`, and the daily time series.
 *
 * The time series approximates each subscription's historical lifecycle from
 * two real columns only — `createdAt` (when it started) and, for a row that
 * has since ended (CANCELED/EXPIRED), `updatedAt` as its effective end date.
 * `Subscription` stores only its current status, not a full transition log
 * (that history exists, unjoined, in `PaymentEvent`'s raw payloads), so a
 * subscription that went PAST_DUE and later recovered is treated as
 * continuously active across that dip, and `activeSubscriptions`/`mrrCents`
 * per day count every not-yet-ended subscription (PENDING/ACTIVE/PAST_DUE),
 * not strictly ACTIVE-that-day. This is a documented approximation, not a
 * bug — see docs/architecture.md's Phase 13 section.
 */
export async function getCreatorDashboard(
  prisma: PrismaClient,
  creator: Creator,
  range: DashboardRange,
): Promise<CreatorDashboard> {
  const subscriptions = await prisma.subscription.findMany({
    where: { creatorId: creator.id },
    include: { tier: true },
  });

  const subscriberCount = subscriptions.filter((s) => ACTIVE_ISH_STATUSES.includes(s.status)).length;
  const activeSubs = subscriptions.filter((s) => s.status === "ACTIVE");
  const mrrCents = activeSubs.reduce((sum, s) => sum + s.priceCentsAtSubscription, 0);

  const currency = pickDominantCurrency(
    activeSubs.map((s) => s.currencyAtSubscription),
    pickDominantCurrency(
      subscriptions.map((s) => s.currencyAtSubscription),
      "usd",
    ),
  );

  const tierBreakdown = new Map<string, DashboardTierRevenue>();
  for (const sub of activeSubs) {
    const existing = tierBreakdown.get(sub.tierId);
    if (existing) {
      existing.activeSubscribers += 1;
      existing.monthlyRevenueCents += sub.priceCentsAtSubscription;
    } else {
      tierBreakdown.set(sub.tierId, {
        tierId: sub.tierId,
        tierName: sub.tier.name,
        isActive: sub.tier.isActive,
        activeSubscribers: 1,
        monthlyRevenueCents: sub.priceCentsAtSubscription,
        currency: sub.currencyAtSubscription,
      });
    }
  }
  const revenueByTier = [...tierBreakdown.values()].sort((a, b) => b.monthlyRevenueCents - a.monthlyRevenueCents);

  const newSubscribers = subscriptions.filter((s) => s.createdAt >= range.start && s.createdAt <= range.end).length;
  const cancellations = subscriptions.filter(
    (s) => s.status === "CANCELED" && s.updatedAt >= range.start && s.updatedAt <= range.end,
  ).length;

  const timeSeries = enumerateDays(range).map((day) => {
    const newThatDay = subscriptions.filter((s) => s.createdAt >= day.start && s.createdAt <= day.end).length;
    const canceledThatDay = subscriptions.filter(
      (s) => s.status === "CANCELED" && s.updatedAt >= day.start && s.updatedAt <= day.end,
    ).length;
    const activeAsOfDay = subscriptions.filter((s) => {
      if (s.createdAt > day.end) return false;
      if (ENDED_STATUSES.includes(s.status) && s.updatedAt <= day.end) return false;
      return true;
    });

    return {
      date: dayKey(day.start),
      newSubscribers: newThatDay,
      cancellations: canceledThatDay,
      activeSubscriptions: activeAsOfDay.length,
      mrrCents: activeAsOfDay.reduce((sum, s) => sum + s.priceCentsAtSubscription, 0),
    };
  });

  return {
    range: { start: range.start.toISOString(), end: range.end.toISOString() },
    currency,
    subscriberCount,
    activeSubscriptions: activeSubs.length,
    mrrCents,
    revenueByTier,
    newSubscribers,
    cancellations,
    timeSeries,
  };
}
