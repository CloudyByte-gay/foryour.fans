import { describe, expect, it } from "vitest";
import { bskyAppUrl, postBadges, type FullPost, type LockedPost } from "./post";

function full(over: Partial<FullPost> = {}): FullPost {
  return {
    id: "p1",
    creatorId: "c1",
    visibility: "PUBLIC",
    minimumTierId: null,
    text: "hi",
    media: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    foryourAtUri: "at://did:plc:a/fans.foryour.post/1",
    foryourAtCid: "bafy1",
    bskyAtUri: null,
    bskyAtCid: null,
    canonicalUri: "at://did:plc:a/fans.foryour.post/1",
    sourceCollections: ["fans.foryour.post"],
    ...over,
  };
}

describe("postBadges", () => {
  it("a mirror-only public post is just Public", () => {
    expect(postBadges(full()).map((b) => b.label)).toEqual(["Public"]);
  });
  it("a dual-published public post shows Public + Bluesky", () => {
    const post = full({
      bskyAtUri: "at://did:plc:a/app.bsky.feed.post/2",
      sourceCollections: ["fans.foryour.post", "app.bsky.feed.post"],
    });
    expect(postBadges(post).map((b) => b.label)).toEqual(["Public", "Bluesky"]);
  });
  it("a SUBSCRIBERS post shows Subscriber-only", () => {
    expect(postBadges(full({ visibility: "SUBSCRIBERS" })).map((b) => b.label)).toEqual(["Subscriber-only"]);
  });
  it("a locked stub shows the tier and Locked", () => {
    const locked: LockedPost = {
      id: "p2",
      creatorId: "c1",
      visibility: "TIER",
      createdAt: "2026-01-01T00:00:00.000Z",
      locked: true,
      hasMedia: false,
      requiredTier: { id: "t1", name: "VIP", priceCents: 900, currency: "usd" },
    };
    expect(postBadges(locked).map((b) => b.label)).toEqual(["Tier · VIP", "Locked"]);
  });
});

describe("bskyAppUrl", () => {
  it("builds a permalink for an app.bsky.feed.post URI", () => {
    expect(bskyAppUrl("at://did:plc:a/app.bsky.feed.post/3k", "alice.test")).toBe(
      "https://bsky.app/profile/alice.test/post/3k",
    );
  });
  it("returns null for a non-bsky URI or null", () => {
    expect(bskyAppUrl("at://did:plc:a/fans.foryour.post/3k")).toBeNull();
    expect(bskyAppUrl(null)).toBeNull();
  });
});
