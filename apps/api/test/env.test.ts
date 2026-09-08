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

/**
 * Phase 15 — closes prompts/security-hardening.md's open item #1/#5: a
 * production env must never be able to select a fake payment/payout
 * provider or enable creator-owned gated content, since neither is
 * production-safe yet (no real processor exists; gated-PDS mode has a
 * documented offline-ciphertext risk — see docs/creator-owned-pds.md).
 * A valid "production" env also needs ATPROTO_OAUTH_MODE=hosted +
 * ATPROTO_OAUTH_PRIVATE_KEY (loopback is already forbidden in production —
 * pre-existing behavior), so every test below supplies those too.
 */
describe("loadEnv production guards (prompts/security-hardening.md)", () => {
  const PRODUCTION_BASE = {
    DATABASE_URL: "postgresql://prod",
    REDIS_URL: "redis://prod:6379",
    NODE_ENV: "production",
    ATPROTO_OAUTH_MODE: "hosted",
    ATPROTO_OAUTH_PRIVATE_KEY: "fake-pem-for-test",
  };

  it("defaults PAYMENT_PROVIDER/PAYOUT_PROVIDER to fake", () => {
    const env = loadEnv({ ...REQUIRED });
    expect(env.PAYMENT_PROVIDER).toBe("fake");
    expect(env.PAYOUT_PROVIDER).toBe("fake");
  });

  it("boots fine with fake providers under development/test", () => {
    expect(() => loadEnv({ ...REQUIRED, PAYMENT_PROVIDER: "fake", PAYOUT_PROVIDER: "fake" })).not.toThrow();
  });

  it("rejects PAYMENT_PROVIDER=fake under NODE_ENV=production", () => {
    expect(() => loadEnv({ ...PRODUCTION_BASE })).toThrow(/PAYMENT_PROVIDER=fake must never be used with NODE_ENV=production/);
  });

  it("rejects PAYOUT_PROVIDER=fake under NODE_ENV=production even if PAYMENT_PROVIDER were real", () => {
    // Both default to "fake" and "fake" is the only value the enum accepts
    // today, so this documents that the payout check is independent of the
    // payment check, not that it's reachable with today's enum.
    expect(() => loadEnv({ ...PRODUCTION_BASE })).toThrow(/PAYOUT_PROVIDER=fake must never be used with NODE_ENV=production/);
  });

  it("rejects CREATOR_OWNED_GATED_CONTENT_ENABLED=true under NODE_ENV=production", () => {
    // No real PAYMENT_PROVIDER/PAYOUT_PROVIDER value exists yet to isolate
    // this guard from the ones above (the enum only accepts "fake" today),
    // so a production env trips every guard it violates at once — zod
    // collects every failing .refine(), not just the first. Asserting the
    // gated-content message is present in that combined error is still a
    // real, meaningful check of THIS guard.
    let error: Error | undefined;
    try {
      loadEnv({ ...PRODUCTION_BASE, CREATOR_OWNED_PDS_ENABLED: "true", CREATOR_OWNED_GATED_CONTENT_ENABLED: "true", CONTENT_KEY_WRAP_SECRET: "a".repeat(16) });
    } catch (e) {
      error = e as Error;
    }
    expect(error?.message).toMatch(/CREATOR_OWNED_GATED_CONTENT_ENABLED must never be true with NODE_ENV=production/);
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
