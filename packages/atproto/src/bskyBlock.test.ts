import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BskyBlockValidationError, buildBskyBlockRecord, validateBskyBlockRecord } from "./bskyBlock.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const vendoredBlock: any = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../lexicons/vendor/app/bsky/graph/block.json", import.meta.url)), "utf8"),
);

describe("vendored lexicon stays in sync with the validator", () => {
  it("matches required fields and the record key type", () => {
    expect(vendoredBlock.id).toBe("app.bsky.graph.block");
    expect(vendoredBlock.defs.main.key).toBe("tid");
    expect(vendoredBlock.defs.main.record.required).toEqual(["subject", "createdAt"]);
    expect(vendoredBlock.defs.main.record.properties.subject.format).toBe("did");
  });
});

describe("buildBskyBlockRecord", () => {
  it("builds a valid record from a DID", () => {
    const record = buildBskyBlockRecord({ subjectDid: "did:plc:abc123", createdAt: "2026-09-07T00:00:00.000Z" });
    expect(record).toEqual({
      $type: "app.bsky.graph.block",
      subject: "did:plc:abc123",
      createdAt: "2026-09-07T00:00:00.000Z",
    });
  });

  it("defaults createdAt to now when omitted", () => {
    const record = buildBskyBlockRecord({ subjectDid: "did:plc:abc123" });
    expect(Number.isNaN(Date.parse(record.createdAt))).toBe(false);
  });

  it("rejects a non-DID subject", () => {
    expect(() => buildBskyBlockRecord({ subjectDid: "alice.test" })).toThrow(BskyBlockValidationError);
  });
});

describe("validateBskyBlockRecord", () => {
  it("accepts a well-formed record", () => {
    const record = buildBskyBlockRecord({ subjectDid: "did:plc:abc123" });
    expect(() => validateBskyBlockRecord(record)).not.toThrow();
  });

  it("rejects the wrong $type", () => {
    expect(() => validateBskyBlockRecord({ $type: "app.bsky.feed.post", subject: "did:plc:abc123", createdAt: new Date().toISOString() })).toThrow(
      BskyBlockValidationError,
    );
  });

  it("rejects a missing/invalid subject", () => {
    expect(() => validateBskyBlockRecord({ $type: "app.bsky.graph.block", subject: "not-a-did", createdAt: new Date().toISOString() })).toThrow(
      BskyBlockValidationError,
    );
  });

  it("rejects a missing/invalid createdAt", () => {
    expect(() => validateBskyBlockRecord({ $type: "app.bsky.graph.block", subject: "did:plc:abc123", createdAt: "not-a-date" })).toThrow(
      BskyBlockValidationError,
    );
  });
});
