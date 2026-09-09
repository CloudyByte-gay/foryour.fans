import { PassthroughContentClassifier } from "@foryour-fans/moderation";
import { FakePaymentProvider, FakePayoutProvider } from "@foryour-fans/subscriptions";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import {
  createFakeOAuthClient,
  dummyPrisma,
  dummyRedis,
  fakeContentRepository,
  fakeDeleteAtRecord,
  fakeFetchProfile,
  fakeMediaDeps,
  fakePublishAtRecord,
} from "./fakes.js";
import { testEnv } from "./testEnv.js";

function testApp(trustedProxies = "") {
  return buildApp({
    env: testEnv({ TRUSTED_PROXIES: trustedProxies }),
    checkDatabaseConnection: async () => {},
    redis: dummyRedis,
    prisma: dummyPrisma,
    oauthClient: createFakeOAuthClient(),
    fetchProfile: fakeFetchProfile({ did: "did:plc:unused", handle: "unused" }),
    publishAtRecord: fakePublishAtRecord().publish,
    deleteAtRecord: fakeDeleteAtRecord().del,
    paymentProvider: new FakePaymentProvider(),
    payoutProvider: new FakePayoutProvider(),
    contentRepository: fakeContentRepository(dummyPrisma),
    ...fakeMediaDeps(),
    classifier: new PassthroughContentClassifier(),
  });
}

describe("GET /health", () => {
  it.each([
    ["", "203.0.113.8"],
    ["203.0.113.8", "198.51.100.2"],
    ["192.0.2.10", "203.0.113.8"],
  ])("only accepts forwarding through configured proxies (%s)", async (trusted, expected) => {
    const app = testApp(trusted);
    app.get("/test-ip", { config: { rateLimit: false } }, async (request) => ({ ip: request.ip }));
    try {
      const res = await app.inject({ url: "/test-ip", remoteAddress: "203.0.113.8", headers: { "x-forwarded-for": "192.0.2.99, 198.51.100.2" } });
      expect(res.json()).toEqual({ ip: expected });
    } finally { await app.close(); }
  });
  it("returns ok without touching the database", async () => {
    const app = testApp();
    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });

    await app.close();
  });
});
