import { describe, expect, it } from "vitest";
import { mergeIndexedPosts, type IndexedPostRow } from "./merge.js";

const base = {
  cid: null,
  indexedAt: new Date("2026-01-01T00:00:00Z"),
};

function custom(over: Partial<IndexedPostRow>): IndexedPostRow {
  return {
    uri: "at://did:plc:a/fans.foryour.post/1",
    did: "did:plc:a",
    collection: "fans.foryour.post",
    text: "hello",
    bskyUri: null,
    atCreatedAt: new Date("2026-01-01T00:00:00Z"),
    ...base,
    ...over,
  };
}
function bsky(over: Partial<IndexedPostRow>): IndexedPostRow {
  return {
    uri: "at://did:plc:a/app.bsky.feed.post/1",
    did: "did:plc:a",
    collection: "app.bsky.feed.post",
    text: "hello",
    bskyUri: null,
    atCreatedAt: new Date("2026-01-01T00:00:00Z"),
    ...base,
    ...over,
  };
}

describe("mergeIndexedPosts", () => {
  it("merges an explicitly-linked pair into one item", () => {
    const rows = [
      custom({ bskyUri: "at://did:plc:a/app.bsky.feed.post/1" }),
      bsky({}),
    ];
    const merged = mergeIndexedPosts(rows);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.source).toBe("merged");
    expect(merged[0]!.sourceCollections).toEqual(["fans.foryour.post", "app.bsky.feed.post"]);
    expect(merged[0]!.canonicalUri).toBe("at://did:plc:a/fans.foryour.post/1");
  });

  it("merges an unlinked pair with identical text + close timestamps", () => {
    const rows = [
      custom({ bskyUri: null, atCreatedAt: new Date("2026-01-01T00:00:00Z") }),
      bsky({ atCreatedAt: new Date("2026-01-01T00:00:03Z") }),
    ];
    const merged = mergeIndexedPosts(rows);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.source).toBe("merged");
  });

  it("keeps two items when the text differs", () => {
    const rows = [custom({ text: "one" }), bsky({ text: "two" })];
    const merged = mergeIndexedPosts(rows);
    expect(merged).toHaveLength(2);
    expect(merged.map((m) => m.source).sort()).toEqual(["bsky", "custom"]);
  });

  it("keeps two items when the timestamps are far apart", () => {
    const rows = [
      custom({ atCreatedAt: new Date("2026-01-01T00:00:00Z") }),
      bsky({ atCreatedAt: new Date("2026-01-01T00:05:00Z") }),
    ];
    expect(mergeIndexedPosts(rows)).toHaveLength(2);
  });

  it("never merges across DIDs even with identical text", () => {
    const rows = [
      custom({ did: "did:plc:a", uri: "at://did:plc:a/fans.foryour.post/1" }),
      bsky({ did: "did:plc:b", uri: "at://did:plc:b/app.bsky.feed.post/1" }),
    ];
    const merged = mergeIndexedPosts(rows);
    expect(merged).toHaveLength(2);
  });

  it("passes a lone custom post through as source=custom", () => {
    const merged = mergeIndexedPosts([custom({})]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.source).toBe("custom");
    expect(merged[0]!.sourceCollections).toEqual(["fans.foryour.post"]);
  });

  it("passes a lone bsky post through as source=bsky", () => {
    const merged = mergeIndexedPosts([bsky({})]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.source).toBe("bsky");
    expect(merged[0]!.foryourUri).toBeNull();
  });

  it("orders newest-first", () => {
    const rows = [
      custom({ uri: "at://did:plc:a/fans.foryour.post/old", atCreatedAt: new Date("2026-01-01T00:00:00Z") }),
      custom({ uri: "at://did:plc:a/fans.foryour.post/new", atCreatedAt: new Date("2026-02-01T00:00:00Z") }),
    ];
    const merged = mergeIndexedPosts(rows);
    expect(merged[0]!.canonicalUri).toContain("/new");
  });
});
