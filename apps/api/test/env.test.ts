import { describe, expect, it } from "vitest";
import { loadEnv } from "../src/config/env.js";

const REQUIRED = {
  DATABASE_URL: "postgresql://test",
  REDIS_URL: "redis://localhost:6379/15",
  NODE_ENV: "test",
};

/**
 * Regression coverage for a real bug found while smoke-testing PHASE 12's
 * exit checklist ("app starts"): `z.coerce.boolean()` runs `Boolean(value)`
 * on any env var string, so the literal string `"false"` — exactly what
 * .env.example documents as the safe default for these flags — coerced to
 * `true`. `booleanEnvFlag` (src/config/env.ts) replaces it.
 */
describe("loadEnv boolean flags", () => {
  it('treats the literal string "false" as false, not true', () => {
    const env = loadEnv({
      ...REQUIRED,
      CREATOR_OWNED_PDS_ENABLED: "false",
      CREATOR_OWNED_GATED_CONTENT_ENABLED: "false",
      INDEX_BSKY_POSTS: "false",
      S3_FORCE_PATH_STYLE: "false",
    });
    expect(env.CREATOR_OWNED_PDS_ENABLED).toBe(false);
    expect(env.CREATOR_OWNED_GATED_CONTENT_ENABLED).toBe(false);
    expect(env.INDEX_BSKY_POSTS).toBe(false);
    expect(env.S3_FORCE_PATH_STYLE).toBe(false);
  });

  it('treats "true" (any case) as true', () => {
    const env = loadEnv({ ...REQUIRED, CREATOR_OWNED_PDS_ENABLED: "TRUE" });
    expect(env.CREATOR_OWNED_PDS_ENABLED).toBe(true);
  });

  it("falls back to each flag's documented default when unset", () => {
    const env = loadEnv({ ...REQUIRED });
    expect(env.CREATOR_OWNED_PDS_ENABLED).toBe(false);
    expect(env.CREATOR_OWNED_GATED_CONTENT_ENABLED).toBe(false);
    expect(env.INDEX_BSKY_POSTS).toBe(false);
    expect(env.S3_FORCE_PATH_STYLE).toBe(true);
  });

  it("still rejects gated content enabled without CONTENT_KEY_WRAP_SECRET", () => {
    expect(() =>
      loadEnv({ ...REQUIRED, CREATOR_OWNED_PDS_ENABLED: "true", CREATOR_OWNED_GATED_CONTENT_ENABLED: "true" }),
    ).toThrow(/CONTENT_KEY_WRAP_SECRET/);
  });
});

describe("loadEnv ADMIN_DIDS", () => {
  it("defaults to an empty list", () => {
    expect(loadEnv({ ...REQUIRED }).ADMIN_DIDS).toEqual([]);
  });

  it("parses a comma-separated list, trimming whitespace", () => {
    const env = loadEnv({ ...REQUIRED, ADMIN_DIDS: " did:plc:aaa, did:plc:bbb ,did:plc:ccc" });
    expect(env.ADMIN_DIDS).toEqual(["did:plc:aaa", "did:plc:bbb", "did:plc:ccc"]);
  });

  it("treats an empty string the same as unset", () => {
    expect(loadEnv({ ...REQUIRED, ADMIN_DIDS: "" }).ADMIN_DIDS).toEqual([]);
  });
});
