import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createFakeOAuthClient, dummyPrisma, dummyRedis, fakeDeleteAtRecord, fakeFetchProfile, fakePublishAtRecord } from "./fakes.js";
import { testEnv } from "./testEnv.js";

const env = testEnv();
const authDeps = {
  redis: dummyRedis,
  prisma: dummyPrisma,
  oauthClient: createFakeOAuthClient(),
  fetchProfile: fakeFetchProfile({ did: "did:plc:unused", handle: "unused" }),
  publishAtRecord: fakePublishAtRecord().publish,
  deleteAtRecord: fakeDeleteAtRecord().del,
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
    expect(response.json()).toMatchObject({ status: "unavailable" });

    await app.close();
  });
});
