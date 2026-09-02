import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PostCard } from "./PostCard";
import type { FullPost, LockedPost } from "@/lib/post";

function full(over: Partial<FullPost> = {}): FullPost {
  return {
    id: "p1",
    creatorId: "c1",
    visibility: "PUBLIC",
    minimumTierId: null,
    text: "hello open network",
    media: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    foryourAtUri: "at://did:plc:a/fans.foryour.post/1",
    foryourAtCid: "bafy1",
    bskyAtUri: "at://did:plc:a/app.bsky.feed.post/2",
    bskyAtCid: "bafy2",
    canonicalUri: "at://did:plc:a/fans.foryour.post/1",
    sourceCollections: ["fans.foryour.post", "app.bsky.feed.post"],
    creator: { did: "did:plc:a", handle: "alice.test" },
    ...over,
  };
}

describe("PostCard", () => {
  it("renders a dual-published post as one card with Public + Bluesky + a Bluesky link", () => {
    render(<PostCard post={full()} />);
    expect(screen.getByText("hello open network")).toBeInTheDocument();
    expect(screen.getByText("Public")).toBeInTheDocument();
    expect(screen.getByText("Bluesky")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /view on bluesky/i });
    expect(link).toHaveAttribute("href", "https://bsky.app/profile/alice.test/post/2");
  });

  it("a mirror-only public post has no Bluesky chip or link", () => {
    render(<PostCard post={full({ bskyAtUri: null, sourceCollections: ["fans.foryour.post"] })} />);
    expect(screen.queryByText("Bluesky")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /view on bluesky/i })).not.toBeInTheDocument();
  });

  it("a locked stub shows no body", () => {
    const locked: LockedPost = {
      id: "p2",
      creatorId: "c1",
      visibility: "SUBSCRIBERS",
      createdAt: new Date().toISOString(),
      locked: true,
      hasMedia: true,
      requiredTier: null,
    };
    render(<PostCard post={locked} />);
    expect(screen.getByText("Locked")).toBeInTheDocument();
    expect(screen.getByText(/subscribe to unlock/i)).toBeInTheDocument();
    expect(screen.queryByText("hello open network")).not.toBeInTheDocument();
  });
});
