import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TierCard, type PublicTier } from "./TierCard";

const tier: PublicTier = {
  id: "t1",
  name: "Gold",
  description: "Everything, plus behind-the-scenes.",
  priceCents: 1500,
  currency: "usd",
  sortOrder: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("TierCard", () => {
  it("shows the name, formatted monthly price and description", () => {
    render(<TierCard tier={tier} />);
    expect(screen.getByRole("heading", { name: "Gold" })).toBeInTheDocument();
    expect(screen.getByText("$15.00")).toBeInTheDocument();
    expect(screen.getByText(/behind-the-scenes/)).toBeInTheDocument();
  });

  it("renders the action slot when provided", () => {
    render(<TierCard tier={tier} action={<button type="button">Subscribe</button>} />);
    expect(screen.getByRole("button", { name: "Subscribe" })).toBeInTheDocument();
  });

  it("omits the description block when there is none", () => {
    render(<TierCard tier={{ ...tier, description: null }} />);
    expect(screen.queryByText(/behind-the-scenes/)).not.toBeInTheDocument();
  });
});
