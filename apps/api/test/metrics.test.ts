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

function testApp() {
  return buildApp({
    env: testEnv(),
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

describe("GET /metrics", () => {
  it("exposes Prometheus-format default process metrics without touching Redis/Postgres", async () => {
    const app = testApp();
    const response = await app.inject({ method: "GET", url: "/metrics" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/plain");
    expect(response.body).toContain("process_cpu_user_seconds_total");

    await app.close();
  });

  it("records an http_request_duration_seconds observation for a request that already happened", async () => {
    const app = testApp();
    await app.inject({ method: "GET", url: "/health" });

    const response = await app.inject({ method: "GET", url: "/metrics" });
    expect(response.body).toContain("http_request_duration_seconds");
    expect(response.body).toContain('route="/health"');

    await app.close();
  });

  it("is exempt from rate limiting, unlike an ordinary route", async () => {
    const app = testApp();
    for (let i = 0; i < 5; i += 1) {
      const response = await app.inject({ method: "GET", url: "/metrics" });
      expect(response.statusCode).toBe(200);
    }
    await app.close();
  });
});
