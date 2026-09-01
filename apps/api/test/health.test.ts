import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createFakeOAuthClient, dummyPrisma, dummyRedis, fakeFetchProfile } from "./fakes.js";
import { testEnv } from "./testEnv.js";

function testApp() {
  return buildApp({
    env: testEnv(),
    checkDatabaseConnection: async () => {},
    redis: dummyRedis,
    prisma: dummyPrisma,
    oauthClient: createFakeOAuthClient(),
    fetchProfile: fakeFetchProfile({ did: "did:plc:unused", handle: "unused" }),
  });
}

describe("GET /health", () => {
  it("returns ok without touching the database", async () => {
    const app = testApp();
    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });

    await app.close();
  });
});
