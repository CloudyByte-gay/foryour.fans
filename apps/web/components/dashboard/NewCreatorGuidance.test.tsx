import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NewCreatorGuidance } from "./NewCreatorGuidance";

describe("NewCreatorGuidance", () => {
  it("shows a CTA for every incomplete item", () => {
    render(<NewCreatorGuidance hasPost={false} hasTier={false} payoutVerified={false} />);
    expect(screen.getByRole("link", { name: "Write a post" })).toHaveAttribute("href", "/creator/posts/new");
    expect(screen.getByRole("link", { name: "Set up tiers" })).toHaveAttribute("href", "/creator/tiers");
    expect(screen.getByRole("link", { name: "Set up payouts" })).toHaveAttribute("href", "/creator/payouts");
  });

  it("marks completed items done and drops their CTA", () => {
    render(<NewCreatorGuidance hasPost={true} hasTier={true} payoutVerified={true} />);
    expect(screen.queryByRole("link", { name: "Write a post" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Set up tiers" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Set up payouts" })).not.toBeInTheDocument();
    expect(screen.getByText("Publish your first post")).toHaveClass("line-through");
  });

  it("tracks each item independently", () => {
    render(<NewCreatorGuidance hasPost={true} hasTier={false} payoutVerified={false} />);
    expect(screen.queryByRole("link", { name: "Write a post" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Set up tiers" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Set up payouts" })).toBeInTheDocument();
  });
});
