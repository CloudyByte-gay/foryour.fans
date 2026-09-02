import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Avatar, initialsFrom } from "./Avatar";

describe("initialsFrom", () => {
  it("takes the first and last word initials", () => {
    expect(initialsFrom("Ada Lovelace")).toBe("AL");
    expect(initialsFrom("grace brewster murray hopper")).toBe("GH");
  });

  it("handles a single name", () => {
    expect(initialsFrom("Cher")).toBe("C");
  });

  it("falls back to ? for empty or missing input", () => {
    expect(initialsFrom("")).toBe("?");
    expect(initialsFrom(null)).toBe("?");
    expect(initialsFrom("   ")).toBe("?");
  });
});

describe("Avatar", () => {
  it("shows fallback initials when there is no image", async () => {
    render(<Avatar name="Katherine Johnson" />);
    expect(await screen.findByText("KJ")).toBeInTheDocument();
  });
});
