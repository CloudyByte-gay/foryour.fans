import { randomUUID } from "node:crypto";
import { getPrismaClient, type PrismaClient } from "@foryour-fans/database";
import { PassthroughContentClassifier } from "@foryour-fans/moderation";
import { getRedisClient } from "@foryour-fans/shared";
import { FakePaymentProvider, FakePayoutProvider } from "@foryour-fans/subscriptions";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createFakeOAuthClient, fakeContentRepository, fakeDeleteAtRecord, fakeFetchProfile, fakeMediaDeps, fakePublishAtRecord } from "./fakes.js";
import { testEnv } from "./testEnv.js";

const env = testEnv();
const prisma: PrismaClient = getPrismaClient();
const redis = getRedisClient(env.REDIS_URL);

function testApp(fetchProfile: ReturnType<typeof fakeFetchProfile>, oauthClientOverrides = {}) {
  return buildApp({
    env,
    checkDatabaseConnection: async () => {},
    redis,
    prisma,
    oauthClient: createFakeOAuthClient(oauthClientOverrides),
    fetchProfile,
    publishAtRecord: fakePublishAtRecord().publish,
    deleteAtRecord: fakeDeleteAtRecord().del,
    paymentProvider: new FakePaymentProvider(),
    payoutProvider: new FakePayoutProvider(),
    contentRepository: fakeContentRepository(prisma),
    ...fakeMediaDeps(),
    classifier: new PassthroughContentClassifier(),
  });
}

function newDid(): string {
  return `did:plc:test${randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

async function cleanupUser(did: string) {
  await prisma.user.deleteMany({ where: { did } });
}

afterAll(async () => {
  await prisma.$disconnect();
  redis.disconnect();
});

describe("AT Protocol OAuth callback", () => {
  it("creates a new User on first login", async () => {
    const did = newDid();
    const app = testApp(fakeFetchProfile({ did, handle: "newuser.test", displayName: "New User" }));

    const response = await app.inject({ method: "GET", url: "/auth/atproto/callback?code=fake&state=fake" });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe(`${env.PUBLIC_URL}/auth/callback`);

    const cookieNames = response.cookies.map((c) => c.name).sort();
    expect(cookieNames).toEqual(["ff_csrf", "ff_session"]);

    const user = await prisma.user.findUnique({ where: { did } });
    expect(user).not.toBeNull();
    expect(user?.handle).toBe("newuser.test");
    expect(user?.displayName).toBe("New User");

    await app.close();
    await cleanupUser(did);
  });

  it("updates the existing User on a returning login without creating a duplicate", async () => {
    const did = newDid();

    const firstApp = testApp(fakeFetchProfile({ did, handle: "old-handle.test", displayName: "Old Name" }));
    await firstApp.inject({ method: "GET", url: "/auth/atproto/callback?code=fake&state=fake" });
    await firstApp.close();

    const firstUser = await prisma.user.findUniqueOrThrow({ where: { did } });

    const secondApp = testApp(fakeFetchProfile({ did, handle: "new-handle.test", displayName: "New Name" }));
    const response = await secondApp.inject({ method: "GET", url: "/auth/atproto/callback?code=fake&state=fake" });
    await secondApp.close();

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe(`${env.PUBLIC_URL}/auth/callback`);

    const users = await prisma.user.findMany({ where: { did } });
    expect(users).toHaveLength(1);
    expect(users[0]?.id).toBe(firstUser.id);
    expect(users[0]?.handle).toBe("new-handle.test");
    expect(users[0]?.displayName).toBe("New Name");

    await cleanupUser(did);
  });

  it("forwards an authorization-server error to the web callback page without a session", async () => {
    const app = testApp(fakeFetchProfile({ did: newDid(), handle: "irrelevant.test" }));

    const response = await app.inject({
      method: "GET",
      url: "/auth/atproto/callback?error=access_denied&state=fake",
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe(`${env.PUBLIC_URL}/auth/callback?error=access_denied`);
    expect(response.cookies).toHaveLength(0);

    await app.close();
  });

  it("redirects to the web callback page with error=exchange_failed when the token exchange throws", async () => {
    const app = testApp(fakeFetchProfile({ did: newDid(), handle: "irrelevant.test" }), {
      callback: async () => {
        throw new Error("bad code");
      },
    });

    const response = await app.inject({ method: "GET", url: "/auth/atproto/callback?code=bad&state=fake" });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe(`${env.PUBLIC_URL}/auth/callback?error=exchange_failed`);
    expect(response.cookies).toHaveLength(0);

    await app.close();
  });
});

describe("session lifecycle", () => {
  let did: string;

  beforeEach(() => {
    did = newDid();
  });

  async function login(app: ReturnType<typeof testApp>) {
    const response = await app.inject({ method: "GET", url: "/auth/atproto/callback?code=fake&state=fake" });
    const sessionCookie = response.cookies.find((c) => c.name === "ff_session");
    const csrfCookie = response.cookies.find((c) => c.name === "ff_csrf");
    if (!sessionCookie || !csrfCookie) throw new Error("login did not set expected cookies");
    return { sessionId: sessionCookie.value, csrfToken: csrfCookie.value };
  }

  it("GET /me returns 401 without a session cookie", async () => {
    const app = testApp(fakeFetchProfile({ did, handle: "a.test" }));
    const response = await app.inject({ method: "GET", url: "/me" });
    expect(response.statusCode).toBe(401);
    await app.close();
    await cleanupUser(did);
  });

  it("GET /me returns the caller's identity with a valid session cookie", async () => {
    const app = testApp(
      fakeFetchProfile({
        did,
        handle: "a.test",
        avatarUrl: "https://cdn.example/a.png",
        bannerUrl: "https://cdn.example/a-banner.png",
      }),
    );
    const { sessionId } = await login(app);

    const response = await app.inject({
      method: "GET",
      url: "/me",
      cookies: { ff_session: sessionId },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      did,
      handle: "a.test",
      displayName: null,
      avatarUrl: "https://cdn.example/a.png",
      bannerUrl: "https://cdn.example/a-banner.png",
    });

    await app.close();
    await cleanupUser(did);
  });

  it("POST /auth/logout rejects a mismatched CSRF token and leaves the session valid", async () => {
    const app = testApp(fakeFetchProfile({ did, handle: "a.test" }));
    const { sessionId } = await login(app);

    const logoutResponse = await app.inject({
      method: "POST",
      url: "/auth/logout",
      cookies: { ff_session: sessionId },
      headers: { "x-csrf-token": "wrong-token" },
    });
    expect(logoutResponse.statusCode).toBe(403);

    const meResponse = await app.inject({ method: "GET", url: "/me", cookies: { ff_session: sessionId } });
    expect(meResponse.statusCode).toBe(200);

    await app.close();
    await cleanupUser(did);
  });

  it("POST /auth/logout with a valid CSRF token destroys the session", async () => {
    const app = testApp(fakeFetchProfile({ did, handle: "a.test" }));
    const { sessionId, csrfToken } = await login(app);

    const logoutResponse = await app.inject({
      method: "POST",
      url: "/auth/logout",
      cookies: { ff_session: sessionId },
      headers: { "x-csrf-token": csrfToken },
    });
    expect(logoutResponse.statusCode).toBe(204);

    const meResponse = await app.inject({ method: "GET", url: "/me", cookies: { ff_session: sessionId } });
    expect(meResponse.statusCode).toBe(401);

    await app.close();
    await cleanupUser(did);
  });
});

describe("POST /me/refresh", () => {
  async function loginWith(app: ReturnType<typeof testApp>) {
    const response = await app.inject({ method: "GET", url: "/auth/atproto/callback?code=fake&state=fake" });
    const sessionId = response.cookies.find((c) => c.name === "ff_session")?.value;
    const csrfToken = response.cookies.find((c) => c.name === "ff_csrf")?.value;
    if (!sessionId || !csrfToken) throw new Error("login did not set expected cookies");
    return { sessionId, csrfToken };
  }

  it("401s without a session", async () => {
    const app = testApp(fakeFetchProfile({ did: newDid(), handle: "a.test" }));
    const response = await app.inject({ method: "POST", url: "/me/refresh" });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("403s without a matching CSRF token", async () => {
    const did = newDid();
    const app = testApp(fakeFetchProfile({ did, handle: "a.test" }));
    const { sessionId } = await loginWith(app);

    const response = await app.inject({
      method: "POST",
      url: "/me/refresh",
      cookies: { ff_session: sessionId },
      headers: { "x-csrf-token": "wrong" },
    });
    expect(response.statusCode).toBe(403);

    await app.close();
    await cleanupUser(did);
  });

  it("re-syncs the cached profile fields from the PDS", async () => {
    const did = newDid();
    const app = testApp(
      fakeFetchProfile({
        did,
        handle: "canonical.test",
        displayName: "Canonical",
        avatarUrl: "https://cdn.example/canonical.png",
        bannerUrl: "https://cdn.example/canonical-banner.png",
      }),
    );
    const { sessionId, csrfToken } = await loginWith(app);

    // Simulate the local cache drifting from the PDS.
    await prisma.user.update({
      where: { did },
      data: {
        handle: "stale.test",
        displayName: "Stale",
        avatarUrl: "https://cdn.example/stale.png",
        bannerUrl: "https://cdn.example/stale-banner.png",
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/me/refresh",
      cookies: { ff_session: sessionId },
      headers: { "x-csrf-token": csrfToken },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      did,
      handle: "canonical.test",
      displayName: "Canonical",
      avatarUrl: "https://cdn.example/canonical.png",
      bannerUrl: "https://cdn.example/canonical-banner.png",
    });

    const user = await prisma.user.findUniqueOrThrow({ where: { did } });
    expect(user.handle).toBe("canonical.test");
    expect(user.avatarUrl).toBe("https://cdn.example/canonical.png");
    expect(user.bannerUrl).toBe("https://cdn.example/canonical-banner.png");

    await app.close();
    await cleanupUser(did);
  });

  it("502s when the atproto session can't be restored", async () => {
    const did = newDid();
    const app = testApp(fakeFetchProfile({ did, handle: "a.test" }), {
      restore: async () => {
        throw new Error("no stored session");
      },
    });
    const { sessionId, csrfToken } = await loginWith(app);

    const response = await app.inject({
      method: "POST",
      url: "/me/refresh",
      cookies: { ff_session: sessionId },
      headers: { "x-csrf-token": csrfToken },
    });
    expect(response.statusCode).toBe(502);

    await app.close();
    await cleanupUser(did);
  });
});

describe("POST /auth/atproto/start", () => {
  it("returns a redirectUrl for a valid handle", async () => {
    const app = testApp(fakeFetchProfile({ did: newDid(), handle: "irrelevant.test" }));

    const response = await app.inject({
      method: "POST",
      url: "/auth/atproto/start",
      payload: { handle: "alice.bsky.social" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ redirectUrl: "https://pds.example/oauth/authorize?fake=1" });

    await app.close();
  });

  it("returns 400 when the handle is missing", async () => {
    const app = testApp(fakeFetchProfile({ did: newDid(), handle: "irrelevant.test" }));

    const response = await app.inject({ method: "POST", url: "/auth/atproto/start", payload: {} });

    expect(response.statusCode).toBe(400);

    await app.close();
  });

  it("returns 400 when the oauth client fails to resolve the handle", async () => {
    const app = testApp(fakeFetchProfile({ did: newDid(), handle: "irrelevant.test" }), {
      authorize: async () => {
        throw new Error("could not resolve handle");
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/auth/atproto/start",
      payload: { handle: "nonexistent.invalid" },
    });

    expect(response.statusCode).toBe(400);

    await app.close();
  });

  // Phase 15 — this route gets a much stricter per-route rate limit than
  // the rest of the API (see app.ts) because every call makes a real
  // outbound request to a third-party PDS. A unique x-forwarded-for value
  // isolates this test's Redis-backed counter from every other test's
  // requests, which all resolve to the same "127.0.0.1" key.
  it("429s after exceeding the per-route rate limit", async () => {
    const app = testApp(fakeFetchProfile({ did: newDid(), handle: "irrelevant.test" }));
    const forwardedFor = `203.0.113.${Math.floor(Math.random() * 255)}`;

    let lastResponse;
    for (let i = 0; i < 11; i += 1) {
      lastResponse = await app.inject({
        method: "POST",
        url: "/auth/atproto/start",
        headers: { "x-forwarded-for": forwardedFor },
        payload: { handle: "alice.bsky.social" },
      });
    }

    expect(lastResponse!.statusCode).toBe(429);

    await app.close();
  });
});
