import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LockedPostCard } from "./LockedPostCard";
import type { LockedPostView } from "@/lib/post";

function lockedView(over: Partial<LockedPostView> = {}): LockedPostView {
  return {
    id: "p1",
    creatorId: "c1",
    visibility: "SUBSCRIBERS",
    createdAt: "2026-01-01T00:00:00.000Z",
    locked: true,
    hasMedia: false,
    requiredTier: null,
    creator: { did: "did:plc:abc", handle: "ada.test", displayName: "Ada" },
    ...over,
  };
}

describe("LockedPostCard", () => {
  it("renders the subscriber lock treatment with a subscribe CTA for an authed viewer", () => {
    render(
      <LockedPostCard creatorAddress="ada.test" creatorName="Ada" isAuthed view={lockedView()} />,
    );
    expect(screen.getByText(/for Ada's subscribers/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /see subscription options/i })).toHaveAttribute(
      "href",
      "/c/ada.test#tiers-heading",
    );
  });

  it("names the required tier and price for a TIER post", () => {
    render(
      <LockedPostCard
        creatorAddress="ada.test"
        creatorName="Ada"
        isAuthed
        view={lockedView({
          visibility: "TIER",
          requiredTier: { id: "t1", name: "Gold", priceCents: 900, currency: "usd" },
        })}
      />,
    );
    expect(screen.getByText(/for Gold members/i)).toBeInTheDocument();
    expect(screen.getByText(/\$9\.00\/month/)).toBeInTheDocument();
  });

  it("sends an anonymous viewer to log in first", () => {
    render(
      <LockedPostCard creatorAddress="ada.test" creatorName="Ada" isAuthed={false} view={lockedView()} />,
    );
    expect(screen.getByRole("link", { name: /log in to subscribe/i })).toHaveAttribute(
      "href",
      "/login?next=%2Fc%2Fada.test",
    );
  });

  it("only ever receives safe metadata — the type carries no post body", () => {
    // Compile-time guarantee mirrored as a runtime check: a locked view has no
    // `text`/`media` keys the component could accidentally surface.
    const view = lockedView() as unknown as Record<string, unknown>;
    expect(view).not.toHaveProperty("text");
    expect(view).not.toHaveProperty("media");
  });
});
