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
 *
 * WEB PHASE 6 additions:
 *  - a second seeded creator (`e2e-creator.test`) with one active tier, so the
 *    fixture identity has someone other than itself to subscribe to
 *    (subscribeToTier rejects self-subscription);
 *  - the fake payment/payout providers are pointed at in-process stub routes
 *    (`/__e2e__/checkout`, `/__e2e__/payout-onboarding`) instead of the
 *    unreachable `*.example` hosts, so the browser can actually follow the
 *    hosted-checkout / hosted-onboarding redirect;
 *  - the checkout stub fires the `subscription.activated` webhook on
 *    "payment", which is the only thing that moves a Subscription PENDING ->
 *    ACTIVE (packages/subscriptions/src/webhooks.ts).
 */
import { syncUserFromProfile } from "@foryour-fans/auth";
import { getPrismaClient } from "@foryour-fans/database";
import { getRedisClient } from "@foryour-fans/shared";
import {
  FakePaymentProvider,
  FakePayoutProvider,
  fakeWebhookDelivery,
  processWebhookEvent,
} from "@foryour-fans/subscriptions";
import { buildApp } from "../../src/app.js";
import { loadEnv } from "../../src/config/env.js";
import {
  createFakeOAuthClient,
  fakeContentRepository,
  fakeDeleteAtRecord,
  fakeFetchProfile,
  fakeMediaDeps,
  fakePublishAtRecord,
} from "../fakes.js";

const env = loadEnv();
const prisma = getPrismaClient();
const redis = getRedisClient(env.REDIS_URL);

const FIXTURE_DID = "did:plc:teste2efakeuser00000000";

// A second creator the fixture identity can subscribe to. Seeded fresh on
// every boot (below) — the subscribe e2e never touches the fixture's own
// creator state, so it's robust to whatever the creator/tier specs left
// behind earlier in the same run.
const OTHER_CREATOR = {
  did: "did:plc:teste2eothercreator0000",
  handle: "e2e-creator.test",
  displayName: "E2E Creator Two",
  tierRkey: "e2e-seed-supporter-tier",
};

const SEED_DIDS = [FIXTURE_DID, OTHER_CREATOR.did];

// Start every run from a clean slate for the seeded identities so the
// "become a creator" e2e isn't blocked by a row left over from a prior run.
// Same FK ordering as helpers.ts `cleanupUser`: rows that reference a
// creator/user with no ON DELETE CASCADE (subscriptions, payout accounts,
// posts, tiers) must go first.
await prisma.subscription.deleteMany({
  where: {
    OR: [
      { subscriberUser: { did: { in: SEED_DIDS } } },
      { creator: { did: { in: SEED_DIDS } } },
    ],
  },
});
await prisma.payoutAccount.deleteMany({ where: { creator: { did: { in: SEED_DIDS } } } });
await prisma.post.deleteMany({ where: { creator: { did: { in: SEED_DIDS } } } });
await prisma.subscriptionTier.deleteMany({ where: { creator: { did: { in: SEED_DIDS } } } });
await prisma.creatorHandleHistory.deleteMany({ where: { did: { in: SEED_DIDS } } });
await prisma.creator.deleteMany({ where: { did: { in: SEED_DIDS } } });
await prisma.user.deleteMany({ where: { did: { in: SEED_DIDS } } });

// Seed the second creator + one active tier.
const otherUser = await prisma.user.create({
  data: { did: OTHER_CREATOR.did, handle: OTHER_CREATOR.handle, displayName: OTHER_CREATOR.displayName },
});
const otherCreator = await prisma.creator.create({
  data: {
    userId: otherUser.id,
    did: OTHER_CREATOR.did,
    displayName: OTHER_CREATOR.displayName,
    bio: "Seeded by the e2e fake API so the fixture identity has someone to subscribe to.",
  },
});
await prisma.subscriptionTier.create({
  data: {
    creatorId: otherCreator.id,
    name: "Supporter",
    description: "Monthly support tier — seeded for the subscribe e2e.",
    priceCents: 500,
    currency: "usd",
    sortOrder: 0,
    isActive: true,
    atRkey: OTHER_CREATOR.tierRkey,
  },
});

// The browser can't reach `https://fake-checkout.example`; point the fake
// providers at stub routes on this same server (reachable through the web
// app's /api/* proxy).
const CHECKOUT_BASE = `${env.PUBLIC_URL}/api/__e2e__/checkout`;
const PAYOUT_ONBOARDING_BASE = `${env.PUBLIC_URL}/api/__e2e__/payout-onboarding`;

const paymentProvider = new FakePaymentProvider({ checkoutBaseUrl: CHECKOUT_BASE });
const payoutProvider = new FakePayoutProvider({ onboardingBaseUrl: PAYOUT_ONBOARDING_BASE });

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
  paymentProvider,
  payoutProvider,
  contentRepository: fakeContentRepository(prisma),
  ...fakeMediaDeps(),
});

// Test-only: let the web Playwright suite simulate a creator changing their
// AT handle (what a real re-login against a PDS reporting a new handle would
// do — appends a CreatorHandleHistory row and overwrites User.handle), so it
// can assert the `/c/<oldhandle>` -> `/c/<newhandle>` redirect.
app.post("/__e2e__/simulate-handle-change", async (request, reply) => {
  const { did, newHandle } = (request.body ?? {}) as { did?: string; newHandle?: string };
  if (!did || !newHandle) {
    return reply.status(400).send({ error: "did and newHandle are required" });
  }
  await syncUserFromProfile(prisma, { did, handle: newHandle });
  return { ok: true };
});

// --- Stub hosted-checkout page (stands in for the payment provider's site) ---
//
// FakePaymentProvider.createSubscription hands the browser
// `${CHECKOUT_BASE}/session/<providerSubscriptionId>?tier=<tierId>`. This
// renders a bare "Complete payment" / "Cancel" page; "Complete payment"
// fires the same `subscription.activated` webhook a real provider would, then
// bounces the browser to the web app's reconciliation route.
function stubPage(title: string, links: Array<{ href: string; label: string }>): string {
  const body = links
    .map((l) => `<a href="${l.href}" style="display:block;margin:8px 0;font-size:18px">${l.label}</a>`)
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body style="font-family:system-ui;padding:40px"><h1>${title}</h1>${body}</body></html>`;
}

app.get("/__e2e__/checkout/session/:providerSubscriptionId", async (request, reply) => {
  const { providerSubscriptionId } = request.params as { providerSubscriptionId: string };
  const q = new URLSearchParams({ sub: providerSubscriptionId });
  return reply.type("text/html").send(
    stubPage("Fake hosted checkout", [
      { href: `/api/__e2e__/checkout/complete?${q.toString()}&outcome=success`, label: "Complete payment" },
      { href: `/api/__e2e__/checkout/complete?${q.toString()}&outcome=cancel`, label: "Cancel" },
    ]),
  );
});

app.get("/__e2e__/checkout/complete", async (request, reply) => {
  const { sub, outcome } = request.query as { sub?: string; outcome?: string };
  if (outcome === "cancel") {
    return reply.redirect(`${env.PUBLIC_URL}/subscribe/cancel`);
  }
  if (sub) {
    const { rawBody, headers } = fakeWebhookDelivery("subscription.activated", sub);
    await processWebhookEvent(prisma, paymentProvider, rawBody, headers);
  }
  return reply.redirect(`${env.PUBLIC_URL}/subscribe/return`);
});

// --- Stub hosted payout onboarding ---
app.get("/__e2e__/payout-onboarding/onboarding/:providerAccountId", async (_request, reply) => {
  return reply.type("text/html").send(
    stubPage("Fake payout onboarding", [
      { href: `/api/__e2e__/payout-onboarding/complete`, label: "Finish onboarding" },
    ]),
  );
});

app.get("/__e2e__/payout-onboarding/complete", async (_request, reply) => {
  // The fake payout provider never transitions past PENDING (there's nothing
  // to transition it to — see FakePayoutProvider). Just bounce back.
  return reply.redirect(`${env.PUBLIC_URL}/creator/payouts`);
});

await app.listen({ port: env.PORT, host: env.HOST });
console.log(`[fake-api] listening on http://${env.HOST}:${env.PORT} (PUBLIC_URL=${env.PUBLIC_URL})`);
