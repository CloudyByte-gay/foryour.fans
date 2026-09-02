import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FeedList } from "./FeedList";
import type { FullPost } from "@/lib/post";

vi.mock("@/lib/apiFetch", () => ({ apiFetch: vi.fn() }));

function post(over: Partial<FullPost>): FullPost {
  return {
    id: "p",
    creatorId: "c",
    visibility: "PUBLIC",
    minimumTierId: null,
    text: "body",
    media: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    foryourAtUri: "at://did:plc:a/fans.foryour.post/1",
    foryourAtCid: null,
    bskyAtUri: null,
    bskyAtCid: null,
    canonicalUri: "at://did:plc:a/fans.foryour.post/1",
    sourceCollections: ["fans.foryour.post"],
    creator: { did: "did:plc:a", handle: "a.test", displayName: null },
    ...over,
  };
}

describe("FeedList", () => {
  it("renders a dual-published post as ONE card with Public + Bluesky", () => {
    render(
      <FeedList
        initialPosts={[
          post({
            id: "dual",
            text: "one authored post",
            bskyAtUri: "at://did:plc:a/app.bsky.feed.post/9",
            sourceCollections: ["fans.foryour.post", "app.bsky.feed.post"],
          }),
        ]}
      />,
    );
    expect(screen.getAllByText("one authored post")).toHaveLength(1);
    expect(screen.getByText("Public")).toBeInTheDocument();
    expect(screen.getByText("Bluesky")).toBeInTheDocument();
  });

  it("renders a Bluesky-only and a custom-only public post each as one card", () => {
    render(
      <FeedList
        initialPosts={[
          post({ id: "bsky-only", text: "from bluesky", bskyAtUri: "at://did:plc:a/app.bsky.feed.post/1", sourceCollections: ["fans.foryour.post", "app.bsky.feed.post"] }),
          post({ id: "custom-only", text: "custom only", bskyAtUri: null }),
        ]}
      />,
    );
    expect(screen.getByText("from bluesky")).toBeInTheDocument();
    expect(screen.getByText("custom only")).toBeInTheDocument();
  });

  it("shows an empty state with nothing to render", () => {
    render(<FeedList initialPosts={[]} />);
    expect(screen.getByText(/nothing here yet/i)).toBeInTheDocument();
  });
});
