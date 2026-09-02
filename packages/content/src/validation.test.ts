import { describe, expect, it } from "vitest";
import { PostValidationError, validatePostFields } from "./validation.js";

describe("validatePostFields", () => {
  it("accepts a PUBLIC post with no minimumTierId", () => {
    expect(() => validatePostFields({ visibility: "PUBLIC", text: "hello" })).not.toThrow();
  });

  it("accepts a SUBSCRIBERS post with no minimumTierId", () => {
    expect(() => validatePostFields({ visibility: "SUBSCRIBERS", text: "hello" })).not.toThrow();
  });

  it("accepts a TIER post with a minimumTierId", () => {
    expect(() =>
      validatePostFields({ visibility: "TIER", minimumTierId: "00000000-0000-0000-0000-000000000000", text: "hello" }),
    ).not.toThrow();
  });

  it("rejects empty text", () => {
    expect(() => validatePostFields({ visibility: "PUBLIC", text: "   " })).toThrow(PostValidationError);
  });

  it("rejects TIER visibility with no minimumTierId", () => {
    expect(() => validatePostFields({ visibility: "TIER", text: "hello" })).toThrow(PostValidationError);
  });

  it("rejects a minimumTierId on a PUBLIC post", () => {
    expect(() =>
      validatePostFields({ visibility: "PUBLIC", minimumTierId: "00000000-0000-0000-0000-000000000000", text: "hello" }),
    ).toThrow(PostValidationError);
  });

  it("rejects a minimumTierId on a SUBSCRIBERS post", () => {
    expect(() =>
      validatePostFields({ visibility: "SUBSCRIBERS", minimumTierId: "00000000-0000-0000-0000-000000000000", text: "hello" }),
    ).toThrow(PostValidationError);
  });
});
