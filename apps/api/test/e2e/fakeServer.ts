/*
 * A throwaway API server for the apps/web Playwright suite. It's the real
 * `buildApp` from src/, wired to the same fakes the API unit tests use
 * (test/fakes.ts) so a browser can complete the OAuth round trip with no
 * real AT handle and no interactive consent:
 *
 *   LoginForm -> POST /auth/atproto/start
 *             -> fake authorize() returns this API's own callback URL
 *             -> GET /auth/atproto/callback (fake callback + profile)
 *             -> sets real session cookies, 302 to <web>/auth/callback
 *
 * Run via tsx (not compiled — this file lives under test/, outside the build
 * graph). Needs real Postgres + Redis for session storage.
 */
import { getPrismaClient } from "@foryour-fans/database";
import { getRedisClient } from "@foryour-fans/shared";
import { FakePaymentProvider, FakePayoutProvider } from "@foryour-fans/subscriptions";
import { buildApp } from "../../src/app.js";
import { loadEnv } from "../../src/config/env.js";
import {
  createFakeOAuthClient,
  fakeContentRepository,
  fakeDeleteAtRecord,
  fakeFetchProfile,
  fakePublishAtRecord,
} from "../fakes.js";

const env = loadEnv();
const prisma = getPrismaClient();
const redis = getRedisClient(env.REDIS_URL);

const FIXTURE_DID = "did:plc:teste2efakeuser00000000";

// Start every run from a clean slate for the fixture identity so the
// "become a creator" e2e isn't blocked by a row left over from a prior run.
await prisma.creator.deleteMany({ where: { did: FIXTURE_DID } });
await prisma.user.deleteMany({ where: { did: FIXTURE_DID } });

const app = buildApp({
  env,
  checkDatabaseConnection: async () => {
    await prisma.$queryRaw`SELECT 1`;
  },
  redis,
  prisma,
  oauthClient: createFakeOAuthClient({
    // Send the browser straight back to our own callback route.
    authorize: async () =>
      new URL(`${env.PUBLIC_URL}/api/auth/atproto/callback?code=e2e&state=e2e`),
  }),
  fetchProfile: fakeFetchProfile({
    did: FIXTURE_DID,
    handle: "e2e-tester.test",
    displayName: "E2E Tester",
  }),
  publishAtRecord: fakePublishAtRecord().publish,
  deleteAtRecord: fakeDeleteAtRecord().del,
  paymentProvider: new FakePaymentProvider(),
  payoutProvider: new FakePayoutProvider(),
  contentRepository: fakeContentRepository(prisma),
});

await app.listen({ port: env.PORT, host: env.HOST });
console.log(`[fake-api] listening on http://${env.HOST}:${env.PORT} (PUBLIC_URL=${env.PUBLIC_URL})`);
