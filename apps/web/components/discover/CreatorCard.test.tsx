import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CreatorCard } from "./CreatorCard";
import type { DiscoveryCreator } from "@/lib/discover";

function creator(overrides: Partial<DiscoveryCreator> = {}): DiscoveryCreator {
  return {
    did: "did:plc:abc123",
    handle: "gamergrace.test",
    displayName: "Gamer Grace",
    bio: "I paint miniatures and play RPGs.",
    website: null,
    isRegisteredCreator: true,
    avatarUrl: null,
    tierCount: 2,
    fromPriceCents: 900,
    fromPriceCurrency: "usd",
    ...overrides,
  };
}

describe("CreatorCard", () => {
  it("links a registered creator to /c/:handle and shows tier count + from-price", () => {
    render(<CreatorCard creator={creator()} />);
    const link = screen.getByRole("link", { name: "Gamer Grace" });
    expect(link).toHaveAttribute("href", "/c/gamergrace.test");
    expect(screen.getByText("@gamergrace.test")).toBeInTheDocument();
    expect(screen.getByText("2 tiers")).toBeInTheDocument();
    expect(screen.getByText("From $9.00/mo")).toBeInTheDocument();
  });

  it("does not link an unregistered creator, and flags it instead", () => {
    render(
      <CreatorCard
        creator={creator({ isRegisteredCreator: false, tierCount: 0, fromPriceCents: null, fromPriceCurrency: null })}
      />,
    );
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("Not on foryour.fans yet")).toBeInTheDocument();
  });

  it("falls back to handle when displayName is missing, and omits the tier badge with no tiers", () => {
    render(<CreatorCard creator={creator({ displayName: null, tierCount: 0, fromPriceCents: null, fromPriceCurrency: null })} />);
    expect(screen.getByRole("link", { name: "gamergrace.test" })).toBeInTheDocument();
    expect(screen.queryByText(/tiers?$/)).not.toBeInTheDocument();
  });
});
