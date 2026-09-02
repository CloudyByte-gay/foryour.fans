import { describe, expect, it } from "vitest";
import { TierValidationError, validateTierFields } from "./tiers.js";

describe("validateTierFields", () => {
  it("accepts a fully valid set of fields", () => {
    expect(() => validateTierFields({ name: "Supporter", priceCents: 500, currency: "usd" })).not.toThrow();
  });

  it("accepts a partial patch with only some fields present", () => {
    expect(() => validateTierFields({ priceCents: 750 })).not.toThrow();
  });

  it("rejects an empty name", () => {
    expect(() => validateTierFields({ name: "   " })).toThrow(TierValidationError);
  });

  it("rejects a zero price", () => {
    expect(() => validateTierFields({ priceCents: 0 })).toThrow(TierValidationError);
  });

  it("rejects a negative price", () => {
    expect(() => validateTierFields({ priceCents: -100 })).toThrow(TierValidationError);
  });

  it("rejects a non-integer price", () => {
    expect(() => validateTierFields({ priceCents: 4.5 })).toThrow(TierValidationError);
  });

  it("rejects an uppercase currency code — callers must normalize before calling", () => {
    expect(() => validateTierFields({ currency: "USD" })).toThrow(TierValidationError);
  });

  it("rejects a currency code that isn't 3 letters", () => {
    expect(() => validateTierFields({ currency: "dollars" })).toThrow(TierValidationError);
  });
});
