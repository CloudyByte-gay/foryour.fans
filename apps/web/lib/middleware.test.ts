// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "../middleware";

afterEach(() => vi.unstubAllEnvs());

describe("content security policy", () => {
  it("passes the same fresh nonce to Next's renderer and the browser", () => {
    vi.stubEnv("NODE_ENV", "production");
    const request = new NextRequest("https://app.test/feed", { headers: { "content-security-policy": "script-src 'unsafe-inline'", "x-nonce": "attacker" } });
    const response = middleware(request);
    const csp = response.headers.get("content-security-policy")!;
    expect(response.headers.get("x-middleware-request-content-security-policy")).toBe(csp);
    const nonce = response.headers.get("x-middleware-request-x-nonce");
    expect(csp).toContain(`'nonce-${nonce}'`);
    expect(nonce).not.toBe("attacker");
    expect(middleware(request).headers.get("content-security-policy")).not.toBe(csp);
    expect(csp.split(";").find((s) => s.trim().startsWith("script-src"))).not.toContain("unsafe-");
    expect(csp).not.toContain("http://");
    expect(csp).toContain("connect-src 'self' https:");
    expect(csp).toContain("media-src 'self' https: blob:");
  });

  it("allows the documented local MinIO endpoint in development", () => {
    vi.stubEnv("NODE_ENV", "development");
    const csp = middleware(new NextRequest("http://127.0.0.1:3000")).headers.get("content-security-policy");
    expect(csp).toContain("http://localhost:9000");
    expect(csp).not.toContain("upgrade-insecure-requests");
  });
});
