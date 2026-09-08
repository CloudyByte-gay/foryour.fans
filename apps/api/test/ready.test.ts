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

const env = testEnv();
const authDeps = {
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
};

describe("GET /ready", () => {
  it("returns ok when the database is reachable", async () => {
    const app = buildApp({ env, checkDatabaseConnection: async () => {}, ...authDeps });
    const response = await app.inject({ method: "GET", url: "/ready" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });

    await app.close();
  });

  it("returns 503 when the database is unreachable", async () => {
    const app = buildApp({
      env,
      checkDatabaseConnection: async () => {
        throw new Error("connection refused");
      },
      ...authDeps,
    });
    const response = await app.inject({ method: "GET", url: "/ready" });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ status: "unavailable", reason: "database unreachable" });

    await app.close();
  });

  // Phase 15 — /ready was database-only; Redis (sessions, OAuth state,
  // rate-limit counters) is just as real a dependency, so a Redis outage
  // must also fail readiness, not report a false "ok".
  it("returns 503 when redis is unreachable", async () => {
    const app = buildApp({
      env,
      checkDatabaseConnection: async () => {},
      checkRedisConnection: async () => {
        throw new Error("connection refused");
      },
      ...authDeps,
    });
    const response = await app.inject({ method: "GET", url: "/ready" });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ status: "unavailable", reason: "redis unreachable" });

    await app.close();
  });

  it("checks the database before redis, so a database failure isn't masked", async () => {
    const app = buildApp({
      env,
      checkDatabaseConnection: async () => {
        throw new Error("connection refused");
      },
      checkRedisConnection: async () => {
        throw new Error("should never run — database check failed first");
      },
      ...authDeps,
    });
    const response = await app.inject({ method: "GET", url: "/ready" });

    expect(response.json()).toMatchObject({ reason: "database unreachable" });

    await app.close();
  });
});
