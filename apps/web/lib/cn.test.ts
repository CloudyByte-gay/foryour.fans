import { describe, expect, it } from "vitest";
import { cn } from "./cn";

describe("cn", () => {
  it("joins truthy class names and drops falsy ones", () => {
    const hidden = false;
    expect(cn("a", hidden && "b", null, undefined, "c")).toBe("a c");
  });

  it("lets a later Tailwind utility win over an earlier conflicting one", () => {
    expect(cn("px-2 text-sm", "px-4")).toBe("text-sm px-4");
  });

  it("supports conditional object syntax", () => {
    expect(cn({ "is-on": true, "is-off": false })).toBe("is-on");
  });
});
