import Fastify from "fastify";
import cookie from "@fastify/cookie";
import type { PrismaClient } from "@foryour-fans/database";
import type { Redis } from "ioredis";
import { describe, expect, it, vi } from "vitest";
import { authRoutes } from "../src/routes/auth.js";
import { sessionPlugin } from "../src/plugins/session.js";
import { createFakeOAuthClient, completeFakeLogin, fakeFetchProfile } from "./fakes.js";

async function setup() {
  const entries = new Map<string, string>();
  const redis = {
    get: async (key: string) => entries.get(key) ?? null,
    set: async (key: string, value: string) => { entries.set(key, value); },
    del: async (key: string) => { entries.delete(key); },
  } as unknown as Redis;
  const profile = { did: "did:plc:securitytest", handle: "alice.test" };
  const upsert = vi.fn(async () => profile);
  const prisma = { user: { findUnique: async () => null, upsert } } as unknown as PrismaClient;
  const oauthClient = createFakeOAuthClient();
  const callback = vi.spyOn(oauthClient, "callback");
  const app = Fastify();
  await app.register(cookie);
  await sessionPlugin(app, { redis });
  await app.register(authRoutes, {
    publicUrl: "https://app.test", isProduction: true, redis, prisma, oauthClient,
    fetchProfile: fakeFetchProfile(profile), adminDids: [], authStartRateLimitMax: 10,
  });
  return { app, entries, upsert, callback };
}

describe("OAuth browser binding", () => {
  it("rejects unsolicited callbacks before exchanging credentials", async () => {
    const { app, callback, upsert } = await setup();
    try {
      const res = await app.inject("/auth/atproto/callback?code=attacker&state=valid");
      expect(res.headers.location).toContain("error=exchange_failed");
      expect(callback).not.toHaveBeenCalled();
      expect(upsert).not.toHaveBeenCalled();
      expect(res.headers["cache-control"]).toBe("private, no-store");
    } finally { await app.close(); }
  });

  it("rejects an exchange started in a different browser", async () => {
    const { app, upsert } = await setup();
    try {
      await app.inject({ method: "POST", url: "/auth/atproto/start", payload: { handle: "alice.test" } });
      const res = await app.inject({ url: "/auth/atproto/callback?code=fake", cookies: { ff_oauth_state: "other-browser" } });
      expect(res.headers.location).toContain("error=exchange_failed");
      expect(upsert).not.toHaveBeenCalled();
      expect(res.cookies.some((c) => c.name === "ff_session")).toBe(false);
    } finally { await app.close(); }
  });

  it("sets secure binding cookies and clears them after a matching exchange", async () => {
    const { app } = await setup();
    try {
      const start = await app.inject({ method: "POST", url: "/auth/atproto/start", payload: { handle: "alice.test" } });
      expect(start.cookies[0]).toMatchObject({ name: "ff_oauth_state", httpOnly: true, secure: true, sameSite: "Lax", maxAge: 600 });
      const res = await completeFakeLogin(app);
      expect(res.headers.location).toBe("https://app.test/auth/callback");
      expect(res.cookies.find((c) => c.name === "ff_session")?.value).toBeTruthy();
      expect(res.cookies.find((c) => c.name === "ff_oauth_state")?.value).toBe("");
    } finally { await app.close(); }
  });

  it("revokes the previous app session on successful sign-in", async () => {
    const { app, entries } = await setup();
    try {
      const first = await completeFakeLogin(app);
      const oldId = first.cookies.find((c) => c.name === "ff_session")!.value;
      const start = await app.inject({ method: "POST", url: "/auth/atproto/start", payload: { handle: "alice.test" } });
      const res = await app.inject({ url: "/auth/atproto/callback?code=fake", cookies: {
        ff_session: oldId, ff_oauth_state: start.cookies[0]!.value,
      } });
      expect(res.headers.location).toBe("https://app.test/auth/callback");
      expect(entries.has(`app:session:${oldId}`)).toBe(false);
    } finally { await app.close(); }
  });
});
