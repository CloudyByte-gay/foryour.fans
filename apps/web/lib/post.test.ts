import { describe, expect, it } from "vitest";
import {
  POST_VISIBILITY_META,
  PUBLIC_POST_WARNING,
  VISIBILITY_ORDER,
  findFeedNeighbors,
  postFormSchema,
} from "./post";

describe("postFormSchema", () => {
  it("accepts a plain SUBSCRIBERS post", () => {
    const r = postFormSchema.safeParse({ visibility: "SUBSCRIBERS", text: "hello" });
    expect(r.success).toBe(true);
  });

  it("rejects empty / whitespace-only text", () => {
    expect(postFormSchema.safeParse({ visibility: "PUBLIC", text: "   " }).success).toBe(false);
  });

  it("rejects text over the max length", () => {
    const r = postFormSchema.safeParse({ visibility: "PUBLIC", text: "x".repeat(10_001) });
    expect(r.success).toBe(false);
  });

  it("requires a tier id when visibility is TIER, on the minimumTierId path", () => {
    const r = postFormSchema.safeParse({ visibility: "TIER", text: "premium" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.path).toEqual(["minimumTierId"]);
    }
  });

  it("accepts a TIER post with a uuid tier id", () => {
    const r = postFormSchema.safeParse({
      visibility: "TIER",
      minimumTierId: "00000000-0000-0000-0000-000000000001",
      text: "premium",
    });
    expect(r.success).toBe(true);
  });
});

describe("findFeedNeighbors", () => {
  const ids = ["newest", "middle", "oldest"];

  it("finds both neighbors for a post in the middle", () => {
    expect(findFeedNeighbors(ids, "middle")).toEqual({ newerId: "newest", olderId: "oldest" });
  });

  it("has no newer neighbor for the newest post", () => {
    expect(findFeedNeighbors(ids, "newest")).toEqual({ newerId: null, olderId: "middle" });
  });

  it("has no older neighbor for the oldest post", () => {
    expect(findFeedNeighbors(ids, "oldest")).toEqual({ newerId: "middle", olderId: null });
  });

  it("returns nulls when the post isn't in the list", () => {
    expect(findFeedNeighbors(ids, "missing")).toEqual({ newerId: null, olderId: null });
  });
});

describe("visibility metadata", () => {
  it("covers every visibility in a stable order", () => {
    expect(VISIBILITY_ORDER).toEqual(["PUBLIC", "SUBSCRIBERS", "TIER"]);
    for (const v of VISIBILITY_ORDER) {
      expect(POST_VISIBILITY_META[v].label).toBeTruthy();
    }
  });

  it("uses the exact mandated public-post warning copy", () => {
    expect(PUBLIC_POST_WARNING).toBe(
      "This publishes to the open AT Protocol network and can be replicated by other apps. " +
        "Subscriber-only content never leaves foryour.fans.",
    );
  });
});
