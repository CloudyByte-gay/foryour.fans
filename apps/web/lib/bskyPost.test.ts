import { describe, expect, it } from "vitest";
import { BSKY_POST_MAX_GRAPHEMES, bskyFitProblems, graphemeLength, utf8ByteLength } from "./bskyPost";

describe("graphemeLength / utf8ByteLength", () => {
  it("counts graphemes, not code units", () => {
    expect(graphemeLength("abc")).toBe(3);
    expect(graphemeLength("👩‍👩‍👧‍👦")).toBe(1);
  });
  it("byte length is UTF-8", () => {
    expect(utf8ByteLength("é")).toBe(2);
    expect(utf8ByteLength("😀")).toBe(4);
  });
});

describe("bskyFitProblems", () => {
  it("is empty for a normal post", () => {
    expect(bskyFitProblems({ text: "hello" })).toEqual([]);
  });
  it("flags an over-length post", () => {
    const problems = bskyFitProblems({ text: "a".repeat(BSKY_POST_MAX_GRAPHEMES + 1) });
    expect(problems.length).toBeGreaterThan(0);
    expect(problems[0]!.message).toMatch(/too long/i);
  });
  it("flags too many langs and tags", () => {
    expect(bskyFitProblems({ text: "x", langs: ["a", "b", "c", "d"] })[0]!.message).toMatch(/languages/i);
    expect(bskyFitProblems({ text: "x", tags: Array(9).fill("t") })[0]!.message).toMatch(/tags/i);
  });
});
