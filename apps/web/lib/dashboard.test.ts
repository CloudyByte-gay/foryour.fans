import { describe, expect, it } from "vitest";
import { dashboardPresetLabel, isNewCreator, isoDate, presetRange, type CreatorDashboard } from "./dashboard";

const BASE_DASHBOARD: CreatorDashboard = {
  range: { start: "2026-08-01T00:00:00.000Z", end: "2026-08-30T23:59:59.999Z" },
  currency: "usd",
  subscriberCount: 0,
  activeSubscriptions: 0,
  mrrCents: 0,
  revenueByTier: [],
  newSubscribers: 0,
  cancellations: 0,
  timeSeries: [],
  payout: null,
  recentPosts: [],
};

describe("isoDate", () => {
  it("formats a Date as YYYY-MM-DD in UTC", () => {
    expect(isoDate(new Date("2026-03-04T23:59:59Z"))).toBe("2026-03-04");
  });
});

describe("presetRange", () => {
  it("returns an inclusive N-day window ending today", () => {
    const now = new Date("2026-08-15T12:00:00Z");
    expect(presetRange("7d", now)).toEqual({ from: "2026-08-09", to: "2026-08-15" });
    expect(presetRange("30d", now)).toEqual({ from: "2026-07-17", to: "2026-08-15" });
    expect(presetRange("90d", now)).toEqual({ from: "2026-05-18", to: "2026-08-15" });
  });
});

describe("dashboardPresetLabel", () => {
  it("labels every preset", () => {
    expect(dashboardPresetLabel("7d")).toBe("Last 7 days");
    expect(dashboardPresetLabel("30d")).toBe("Last 30 days");
    expect(dashboardPresetLabel("90d")).toBe("Last 90 days");
    expect(dashboardPresetLabel("custom")).toBe("Custom");
  });
});

describe("isNewCreator", () => {
  it("is true when there are no tiers, posts, or subscribers at all", () => {
    expect(isNewCreator(BASE_DASHBOARD, 0)).toBe(true);
  });

  it("is false once a tier exists", () => {
    expect(isNewCreator(BASE_DASHBOARD, 1)).toBe(false);
  });

  it("is false once a post exists", () => {
    expect(
      isNewCreator(
        { ...BASE_DASHBOARD, recentPosts: [{ id: "p1", visibility: "PUBLIC", text: "hi", mediaCount: 0, createdAt: "2026-08-01T00:00:00Z" }] },
        0,
      ),
    ).toBe(false);
  });

  it("is false once there's ever been a subscriber, even outside the current range", () => {
    expect(isNewCreator({ ...BASE_DASHBOARD, subscriberCount: 1 }, 0)).toBe(false);
    expect(isNewCreator({ ...BASE_DASHBOARD, newSubscribers: 1 }, 0)).toBe(false);
  });
});
