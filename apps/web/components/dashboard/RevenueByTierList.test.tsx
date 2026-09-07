import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RevenueByTierList } from "./RevenueByTierList";

describe("RevenueByTierList", () => {
  it("shows an empty state when there's no tier revenue yet", () => {
    render(<RevenueByTierList tiers={[]} />);
    expect(screen.getByText("No tier revenue yet")).toBeInTheDocument();
  });

  it("renders each tier's revenue, subscriber count, and price formatting", () => {
    render(
      <RevenueByTierList
        tiers={[
          { tierId: "t1", tierName: "Supporter", isActive: true, activeSubscribers: 3, monthlyRevenueCents: 1500, currency: "usd" },
          { tierId: "t2", tierName: "VIP", isActive: true, activeSubscribers: 1, monthlyRevenueCents: 2000, currency: "usd" },
        ]}
      />,
    );
    expect(screen.getByText("Supporter")).toBeInTheDocument();
    expect(screen.getByText(/\$15\.00.*3 subscribers/)).toBeInTheDocument();
    expect(screen.getByText("VIP")).toBeInTheDocument();
    expect(screen.getByText(/\$20\.00.*1 subscriber\b/)).toBeInTheDocument();
  });

  it("labels a deactivated tier as retired", () => {
    render(
      <RevenueByTierList
        tiers={[{ tierId: "t1", tierName: "Legacy", isActive: false, activeSubscribers: 2, monthlyRevenueCents: 1000, currency: "usd" }]}
      />,
    );
    expect(screen.getByText("(retired)")).toBeInTheDocument();
  });
});
