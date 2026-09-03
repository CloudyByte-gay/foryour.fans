import { describe, expect, it } from "vitest";
import { creatorHref, fromPriceLabel, type DiscoveryCreator } from "./discover";

function creator(overrides: Partial<DiscoveryCreator> = {}): DiscoveryCreator {
  return {
    did: "did:plc:abc123",
    handle: "someone.test",
    displayName: "Someone",
    bio: null,
    website: null,
    isRegisteredCreator: true,
    avatarUrl: null,
    tierCount: 0,
    fromPriceCents: null,
    fromPriceCurrency: null,
    ...overrides,
  };
}

describe("creatorHref", () => {
  it("prefers the handle when present", () => {
    expect(creatorHref(creator({ handle: "alice.test", did: "did:plc:xyz" }))).toBe("/c/alice.test");
  });

  it("falls back to the DID when the handle is unresolved", () => {
    expect(creatorHref(creator({ handle: null, did: "did:plc:xyz" }))).toBe(`/c/${encodeURIComponent("did:plc:xyz")}`);
  });
});

describe("fromPriceLabel", () => {
  it("formats the cheapest active tier's price", () => {
    expect(fromPriceLabel(creator({ fromPriceCents: 900, fromPriceCurrency: "usd" }))).toBe("From $9.00/mo");
  });

  it("returns null for an unregistered or tierless creator", () => {
    expect(fromPriceLabel(creator({ fromPriceCents: null, fromPriceCurrency: null }))).toBeNull();
  });
});
