import { describe, expect, it } from "vitest";
import { SLUG_PATTERN, sanitizeSlugInput, validateSlugShape } from "./slug";

describe("validateSlugShape", () => {
  it("accepts a well-formed slug", () => {
    expect(validateSlugShape("ada-lovelace")).toBeNull();
    expect(validateSlugShape("abc")).toBeNull();
    expect(validateSlugShape("a1b2c3")).toBeNull();
  });

  it("rejects out-of-range lengths", () => {
    expect(validateSlugShape("ab")).toMatch(/3–32/);
    expect(validateSlugShape("a".repeat(33))).toMatch(/3–32/);
  });

  it("rejects bad characters and edge hyphens", () => {
    expect(validateSlugShape("Ada")).toMatch(/lowercase/i);
    expect(validateSlugShape("has space")).toMatch(/lowercase/i);
    expect(validateSlugShape("-lead")).toMatch(/lowercase/i);
    expect(validateSlugShape("trail-")).toMatch(/lowercase/i);
  });

  it("rejects reserved words", () => {
    expect(validateSlugShape("admin")).toMatch(/reserved/i);
    expect(validateSlugShape("settings")).toMatch(/reserved/i);
  });

  it("mirrors the API's SLUG_PATTERN", () => {
    // apps/api/src/services/creators.ts
    expect(SLUG_PATTERN.source).toBe("^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])?$");
  });
});

describe("sanitizeSlugInput", () => {
  it("lowercases, drops invalid chars and clamps length", () => {
    expect(sanitizeSlugInput("Ada Lovelace!")).toBe("adalovelace");
    expect(sanitizeSlugInput("A".repeat(40))).toHaveLength(32);
  });
});
