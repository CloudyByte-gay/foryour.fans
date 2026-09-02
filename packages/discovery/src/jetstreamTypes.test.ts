import { describe, expect, it } from "vitest";
import { parseJetstreamMessage } from "./jetstreamTypes.js";

/**
 * Fixture shapes below are the REAL, verified wire format — captured by
 * connecting directly to the live production endpoint
 * (wss://jetstream.us-east.bsky.network/subscribe), not derived from
 * documentation alone. See jetstreamTypes.ts's doc comment and
 * docs/architecture.md's Phase 10 section for why that distinction
 * mattered here: initial doc-based research pointed at a different-looking
 * "v2" envelope shape that the real server does not actually send.
 */
function commitMessage(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    did: "did:plc:abc123",
    time_us: 1788372537829556,
    cursor: 25407256607,
    kind: "commit",
    commit: {
      rev: "3mukjqx2sbm2f",
      operation: "create",
      collection: "fans.foryour.profile",
      rkey: "self",
      cid: "bafyreig4wtb725kvyixxv6opzuxss22q5ow43mrizabj3hk6cdvov2v5oy",
      record: { $type: "fans.foryour.profile", displayName: "Alice" },
      ...overrides,
    },
  });
}

describe("parseJetstreamMessage", () => {
  it("parses a real-shaped commit message", () => {
    const event = parseJetstreamMessage(commitMessage());
    expect(event).toMatchObject({
      did: "did:plc:abc123",
      timeUs: 1788372537829556,
      operation: "create",
      collection: "fans.foryour.profile",
      rkey: "self",
    });
  });

  it("parses a delete commit with no record/cid", () => {
    const raw = JSON.stringify({
      did: "did:plc:abc123",
      time_us: 1788372538446126,
      cursor: 25407256900,
      kind: "commit",
      commit: { rev: "3mukjqxxdiz2j", operation: "delete", collection: "fans.foryour.post", rkey: "3msx2efqdxs27" },
    });
    const event = parseJetstreamMessage(raw);
    expect(event).toMatchObject({ operation: "delete", collection: "fans.foryour.post" });
    expect(event?.record).toBeUndefined();
    expect(event?.cid).toBeUndefined();
  });

  it("returns null for malformed JSON", () => {
    expect(parseJetstreamMessage("not json{{{")).toBeNull();
  });

  it("returns null for a well-formed but unrelated envelope", () => {
    expect(parseJetstreamMessage(JSON.stringify({ hello: "world" }))).toBeNull();
  });

  it("returns null for an identity event (not handled this phase)", () => {
    const raw = JSON.stringify({ did: "did:plc:abc123", time_us: 1788372537829556, kind: "identity", identity: { handle: "alice.test" } });
    expect(parseJetstreamMessage(raw)).toBeNull();
  });

  it("returns null for an account event (not handled this phase)", () => {
    const raw = JSON.stringify({ did: "did:plc:abc123", time_us: 1788372537829556, kind: "account", account: { active: true } });
    expect(parseJetstreamMessage(raw)).toBeNull();
  });

  it("returns null when a required commit field is missing", () => {
    const raw = JSON.stringify({ did: "did:plc:abc123", time_us: 1788372537829556, kind: "commit" });
    expect(parseJetstreamMessage(raw)).toBeNull();
  });
});
