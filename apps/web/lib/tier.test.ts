import { describe, expect, it } from "vitest";
import {
  amountToMinorUnits,
  formatPrice,
  minorUnitsToAmount,
  tierFormSchema,
} from "./tier";

describe("tierFormSchema", () => {
  const valid = { name: "Supporter", description: "thanks", priceCents: 500, currency: "usd" as const };

  it("accepts a valid tier", () => {
    expect(tierFormSchema.safeParse(valid).success).toBe(true);
  });

  it("allows description to be omitted", () => {
    const { description: _drop, ...rest } = valid;
    expect(tierFormSchema.safeParse(rest).success).toBe(true);
  });

  it("rejects an empty name", () => {
    expect(tierFormSchema.safeParse({ ...valid, name: "  " }).success).toBe(false);
  });

  it("rejects a name over 640 chars (mirrors the API)", () => {
    expect(tierFormSchema.safeParse({ ...valid, name: "x".repeat(641) }).success).toBe(false);
  });

  it("rejects a zero / negative / non-integer price", () => {
    expect(tierFormSchema.safeParse({ ...valid, priceCents: 0 }).success).toBe(false);
    expect(tierFormSchema.safeParse({ ...valid, priceCents: -100 }).success).toBe(false);
    expect(tierFormSchema.safeParse({ ...valid, priceCents: 4.5 }).success).toBe(false);
  });

  it("rejects a currency outside the supported set", () => {
    expect(tierFormSchema.safeParse({ ...valid, currency: "cad" }).success).toBe(false);
    expect(tierFormSchema.safeParse({ ...valid, currency: "USD" }).success).toBe(false);
  });
});

describe("money helpers", () => {
  it("round-trips minor units for a 2-decimal currency", () => {
    expect(amountToMinorUnits("4.99", "usd")).toBe(499);
    expect(minorUnitsToAmount(499, "usd")).toBe("4.99");
    expect(formatPrice(499, "usd")).toBe("$4.99");
  });

  it("handles whole amounts and trims to currency precision", () => {
    expect(amountToMinorUnits("5", "usd")).toBe(500);
    expect(amountToMinorUnits("5.999", "usd")).toBeNull(); // too many decimals for USD
  });

  it("handles a zero-decimal currency (JPY)", () => {
    expect(amountToMinorUnits("500", "jpy")).toBe(500);
    expect(amountToMinorUnits("500.5", "jpy")).toBeNull();
    expect(minorUnitsToAmount(500, "jpy")).toBe("500");
    expect(formatPrice(500, "jpy")).toMatch(/500/);
  });

  it("rejects non-numeric and negative input", () => {
    expect(amountToMinorUnits("", "usd")).toBeNull();
    expect(amountToMinorUnits("abc", "usd")).toBeNull();
    expect(amountToMinorUnits("-1", "usd")).toBeNull();
  });
});
