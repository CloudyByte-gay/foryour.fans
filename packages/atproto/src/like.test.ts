import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  LikeValidationError,
  buildBskyLikeRecord,
  buildForyourLikeRecord,
  validateBskyLikeRecord,
  validateForyourLikeRecord,
} from "./like.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
const vendoredBskyLike: any = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../lexicons/vendor/app/bsky/feed/like.json", import.meta.url)), "utf8"),
);
const authoredForyourLike: any = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../lexicons/lexicons/fans/foryour/like.json", import.meta.url)), "utf8"),
);
/* eslint-enable @typescript-eslint/no-explicit-any */

const subject = {
  uri: "at://did:plc:abc/fans.foryour.post/3kbb",
  cid: "bafyreib2rxk3rybk3aobmv5cjuql3bm2twh4jo5uxgr37vhqtr7g5eyrku",
};

describe("vendored / authored lexicons stay in sync with the validators", () => {
  it("app.bsky.feed.like: required fields + record key type", () => {
    expect(vendoredBskyLike.id).toBe("app.bsky.feed.like");
    expect(vendoredBskyLike.defs.main.key).toBe("tid");
    expect(vendoredBskyLike.defs.main.record.required).toEqual(["subject", "createdAt"]);
  });

  it("fans.foryour.like: required fields + a strong-ref (uri+cid) subject", () => {
    expect(authoredForyourLike.id).toBe("fans.foryour.like");
    expect(authoredForyourLike.defs.main.key).toBe("tid");
    expect(authoredForyourLike.defs.main.record.required).toEqual(["subject", "createdAt"]);
    expect(authoredForyourLike.defs.subject.required).toEqual(["uri", "cid"]);
  });
});

describe("buildForyourLikeRecord / buildBskyLikeRecord", () => {
  it("build the expected record body", () => {
    expect(buildForyourLikeRecord({ subject, createdAt: "2026-09-10T00:00:00.000Z" })).toEqual({
      $type: "fans.foryour.like",
      subject,
      createdAt: "2026-09-10T00:00:00.000Z",
    });
    expect(buildBskyLikeRecord({ subject, createdAt: "2026-09-10T00:00:00.000Z" })).toEqual({
      $type: "app.bsky.feed.like",
      subject,
      createdAt: "2026-09-10T00:00:00.000Z",
    });
  });

  it("default createdAt to now when omitted", () => {
    expect(Number.isNaN(Date.parse(buildForyourLikeRecord({ subject }).createdAt))).toBe(false);
    expect(Number.isNaN(Date.parse(buildBskyLikeRecord({ subject }).createdAt))).toBe(false);
  });

  it("drop extra keys off the subject (only uri + cid round-trip)", () => {
    const record = buildForyourLikeRecord({ subject: { ...subject, extra: "nope" } as never });
    expect(record.subject).toEqual(subject);
  });

  it("reject a subject with no cid", () => {
    expect(() => buildForyourLikeRecord({ subject: { uri: subject.uri } as never })).toThrow(LikeValidationError);
    expect(() => buildBskyLikeRecord({ subject: { uri: subject.uri } as never })).toThrow(LikeValidationError);
  });

  it("reject a non-AT-URI subject", () => {
    expect(() => buildForyourLikeRecord({ subject: { uri: "https://example.com/x", cid: subject.cid } })).toThrow(
      LikeValidationError,
    );
  });
});

describe("validateForyourLikeRecord / validateBskyLikeRecord", () => {
  it("accept a well-formed record built here", () => {
    expect(() => validateForyourLikeRecord(buildForyourLikeRecord({ subject }))).not.toThrow();
    expect(() => validateBskyLikeRecord(buildBskyLikeRecord({ subject }))).not.toThrow();
  });

  it("round-trip build -> validate for the bsky record", () => {
    const record = buildBskyLikeRecord({ subject });
    validateBskyLikeRecord(record);
    expect(record.subject.uri).toBe(subject.uri);
  });

  it("reject a non-object", () => {
    expect(() => validateForyourLikeRecord(null)).toThrow(LikeValidationError);
  });

  it("reject the wrong $type", () => {
    expect(() => validateForyourLikeRecord({ $type: "app.bsky.feed.like", subject, createdAt: new Date().toISOString() })).toThrow(
      LikeValidationError,
    );
    expect(() => validateBskyLikeRecord({ $type: "fans.foryour.like", subject, createdAt: new Date().toISOString() })).toThrow(
      LikeValidationError,
    );
  });

  it("reject a blank cid", () => {
    expect(() => validateForyourLikeRecord({ $type: "fans.foryour.like", subject: { uri: subject.uri, cid: "" }, createdAt: new Date().toISOString() })).toThrow(
      LikeValidationError,
    );
  });

  it("reject a bad createdAt", () => {
    expect(() => validateForyourLikeRecord({ $type: "fans.foryour.like", subject, createdAt: "not-a-date" })).toThrow(
      LikeValidationError,
    );
  });
});
