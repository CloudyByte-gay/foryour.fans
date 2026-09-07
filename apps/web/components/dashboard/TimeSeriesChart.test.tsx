import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TimeSeriesChart } from "./TimeSeriesChart";

const DATA = [
  { date: "2026-08-01", newSubscribers: 1, cancellations: 0, activeSubscriptions: 3, mrrCents: 1500 },
  { date: "2026-08-02", newSubscribers: 0, cancellations: 1, activeSubscriptions: 2, mrrCents: 1000 },
];

describe("TimeSeriesChart", () => {
  it("renders an accessible image region for the series without throwing", () => {
    render(<TimeSeriesChart data={DATA} dataKey="activeSubscriptions" formatValue={(v) => String(v)} ariaLabel="Subscribers over time" />);
    expect(screen.getByRole("img", { name: "Subscribers over time" })).toBeInTheDocument();
  });

  it("renders an empty series without throwing", () => {
    render(<TimeSeriesChart data={[]} dataKey="mrrCents" formatValue={(v) => String(v)} ariaLabel="MRR over time" />);
    expect(screen.getByRole("img", { name: "MRR over time" })).toBeInTheDocument();
  });
});
