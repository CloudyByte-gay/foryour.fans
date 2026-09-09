import { describe, expect, it } from "vitest";
import { isSafeExternalUrl, isSafeInternalPath, safeNextOr } from "./nav";

describe("isSafeInternalPath", () => {
  it("accepts a plain internal path", () => {
    expect(isSafeInternalPath("/dashboard")).toBe(true);
    expect(isSafeInternalPath("/c/alice?tab=posts")).toBe(true);
  });

  it("rejects absolute and protocol-relative URLs (open-redirect guard)", () => {
    expect(isSafeInternalPath("https://evil.example/x")).toBe(false);
    expect(isSafeInternalPath("//evil.example")).toBe(false);
    expect(isSafeInternalPath("/\\evil.example")).toBe(false);
  });

  it("rejects the API proxy and auth routes", () => {
    expect(isSafeInternalPath("/api/creators/me")).toBe(false);
    expect(isSafeInternalPath("/auth/callback")).toBe(false);
  });

  it("rejects non-strings and empty input", () => {
    expect(isSafeInternalPath(undefined)).toBe(false);
    expect(isSafeInternalPath("")).toBe(false);
    expect(isSafeInternalPath("dashboard")).toBe(false);
  });
});

describe("safeNextOr", () => {
  it("passes through a safe path", () => {
    expect(safeNextOr("/settings")).toBe("/settings");
  });

  it("falls back for an unsafe or missing value", () => {
    expect(safeNextOr("https://evil.example")).toBe("/dashboard");
    expect(safeNextOr(undefined)).toBe("/dashboard");
    expect(safeNextOr(null, "/")).toBe("/");
  });
});

describe("isSafeExternalUrl", () => {
  it("accepts http and https URLs", () => {
    expect(isSafeExternalUrl("https://example.com")).toBe(true);
    expect(isSafeExternalUrl("http://example.com/path?q=1")).toBe(true);
  });

  it("rejects javascript: and other non-http(s) schemes (stored-XSS guard)", () => {
    expect(isSafeExternalUrl("javascript:alert(document.cookie)")).toBe(false);
    expect(isSafeExternalUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
    expect(isSafeExternalUrl("vbscript:msgbox(1)")).toBe(false);
  });

  it("rejects non-strings, empty input, and unparseable values", () => {
    expect(isSafeExternalUrl(undefined)).toBe(false);
    expect(isSafeExternalUrl(null)).toBe(false);
    expect(isSafeExternalUrl("")).toBe(false);
    expect(isSafeExternalUrl("not a url")).toBe(false);
  });
});
