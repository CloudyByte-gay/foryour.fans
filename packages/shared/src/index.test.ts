import { describe, expect, it } from "vitest";
import { assertDid, isDid } from "./index.js";

describe("isDid", () => {
  it("accepts a well-formed did:plc", () => {
    expect(isDid("did:plc:abc123")).toBe(true);
  });

  it("rejects a handle", () => {
    expect(isDid("alice.bsky.social")).toBe(false);
  });
});

describe("assertDid", () => {
  it("throws on an invalid DID", () => {
    expect(() => assertDid("not-a-did")).toThrow();
  });
});
