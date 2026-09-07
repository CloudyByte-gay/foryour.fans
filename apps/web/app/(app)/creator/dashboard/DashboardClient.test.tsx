import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardClient } from "./DashboardClient";
import type { CreatorDashboard } from "@/lib/dashboard";

const apiFetchMock = vi.fn();
vi.mock("@/lib/apiFetch", () => ({ apiFetch: (...a: unknown[]) => apiFetchMock(...a) }));

const user = userEvent.setup();

function dashboard(overrides: Partial<CreatorDashboard> = {}): CreatorDashboard {
  return {
    range: { start: "2026-07-17T00:00:00.000Z", end: "2026-08-15T23:59:59.999Z" },
    currency: "usd",
    subscriberCount: 4,
    activeSubscriptions: 3,
    mrrCents: 2500,
    revenueByTier: [{ tierId: "t1", tierName: "Supporter", isActive: true, activeSubscribers: 3, monthlyRevenueCents: 2500, currency: "usd" }],
    newSubscribers: 2,
    cancellations: 1,
    timeSeries: [{ date: "2026-08-15", newSubscribers: 1, cancellations: 0, activeSubscriptions: 3, mrrCents: 2500 }],
    payout: { status: "VERIFIED", provider: "fake" },
    recentPosts: [{ id: "p1", visibility: "PUBLIC", text: "hello", mediaCount: 0, createdAt: "2026-08-14T00:00:00Z" }],
    ...overrides,
  };
}

const RANGE = { from: "2026-07-17", to: "2026-08-15" };

beforeEach(() => {
  apiFetchMock.mockReset();
});

describe("DashboardClient", () => {
  it("renders the initial stats without fetching", () => {
    render(<DashboardClient pageAddress="ada.test" initialRange={RANGE} initialDashboard={dashboard()} tiersCount={1} />);
    expect(screen.getByText("4")).toBeInTheDocument(); // subscriberCount
    expect(screen.getByText("$25.00")).toBeInTheDocument(); // mrrCents, unmasked (VERIFIED)
    expect(screen.getByText("Supporter")).toBeInTheDocument();
    expect(screen.getByText("hello")).toBeInTheDocument();
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it("masks revenue figures until payout is verified", () => {
    render(
      <DashboardClient
        pageAddress="ada.test"
        initialRange={RANGE}
        initialDashboard={dashboard({ payout: { status: "PENDING", provider: "fake" } })}
        tiersCount={1}
      />,
    );
    expect(screen.queryByText("$25.00")).not.toBeInTheDocument();
    expect(screen.getAllByText(/complete payout onboarding to see earnings/i)).toHaveLength(2); // MRR tile + MRR chart
    // Subscriber count is never gated by payout status.
    expect(screen.getByText("4")).toBeInTheDocument();
  });

  it("shows onboarding guidance for a brand-new creator", () => {
    render(
      <DashboardClient
        pageAddress="ada.test"
        initialRange={RANGE}
        initialDashboard={dashboard({ subscriberCount: 0, newSubscribers: 0, recentPosts: [], revenueByTier: [] })}
        tiersCount={0}
      />,
    );
    expect(screen.getByText("Get your dashboard started")).toBeInTheDocument();
  });

  it("hides onboarding guidance once the creator has any real activity", () => {
    render(<DashboardClient pageAddress="ada.test" initialRange={RANGE} initialDashboard={dashboard()} tiersCount={1} />);
    expect(screen.queryByText("Get your dashboard started")).not.toBeInTheDocument();
  });

  it("refetches the dashboard when the date range preset changes", async () => {
    apiFetchMock.mockResolvedValue({ ok: true, json: async () => dashboard({ subscriberCount: 9 }) });

    render(<DashboardClient pageAddress="ada.test" initialRange={RANGE} initialDashboard={dashboard()} tiersCount={1} />);
    await user.click(screen.getByRole("button", { name: "Last 7 days" }));

    await waitFor(() => expect(screen.getByText("9")).toBeInTheDocument());
    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    expect(apiFetchMock.mock.calls[0]![0]).toMatch(/^\/creators\/me\/dashboard\?from=.+&to=.+/);
  });

  it("shows a retryable error state when the refetch fails", async () => {
    apiFetchMock.mockResolvedValueOnce({ ok: false, status: 500 });

    render(<DashboardClient pageAddress="ada.test" initialRange={RANGE} initialDashboard={dashboard()} tiersCount={1} />);
    await user.click(screen.getByRole("button", { name: "Last 90 days" }));

    await screen.findByText(/we couldn't load your dashboard for that range/i);

    apiFetchMock.mockResolvedValueOnce({ ok: true, json: async () => dashboard({ subscriberCount: 42 }) });
    await user.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => expect(screen.getByText("42")).toBeInTheDocument());
  });
});
