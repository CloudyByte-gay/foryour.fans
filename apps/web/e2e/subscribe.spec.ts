import { expect, test, type Page } from "@playwright/test";

// The fixture identity the fake API logs in (apps/api/test/e2e/fakeServer.ts).
const HANDLE = "e2e-tester.test";
const FIXTURE_DID = "did:plc:teste2efakeuser00000000";
// A second creator the fake API seeds on boot, with one active $5/mo tier.
const CREATOR_HANDLE = "e2e-creator.test";

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Bluesky handle").fill(HANDLE);
  await page.getByRole("button", { name: /continue/i }).click();
  await page.waitForURL(/\/dashboard(\?|$)/, { timeout: 15_000 });
}

async function ensureFixtureIsCreator(page: Page) {
  await page.goto("/become-a-creator");
  // Already a creator → bounces straight to the public page.
  if (/\/c\//.test(page.url())) return;
  await page.getByLabel(/display name/i).fill("E2E Creator");
  await page.getByRole("button", { name: "Continue" }).click(); // profile → content rating
  await page.getByRole("button", { name: "Continue" }).click(); // content rating → review
  await page.getByRole("button", { name: /publish creator account/i }).click();
  await page.waitForURL(new RegExp(`/c/${HANDLE.replace(/\./g, "\\.")}$`), { timeout: 15_000 });
}

test.describe.configure({ mode: "serial" });

test("subscribe through the hosted checkout, then manage the subscription", async ({ page }) => {
  await signIn(page);

  // The seeded creator's public page shows a real (enabled) Subscribe button.
  await page.goto(`/c/${CREATOR_HANDLE}`);
  await expect(page.getByRole("heading", { name: "Supporter" })).toBeVisible();
  await expect(page.getByText("$5.00")).toBeVisible();

  // Review dialog: the exact price being locked in + the grandfathering note.
  await page.getByRole("button", { name: "Subscribe" }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("$5.00")).toBeVisible();
  await expect(dialog.getByText(/won.t change what you pay/i)).toBeVisible();
  await dialog.getByRole("button", { name: /continue to checkout/i }).click();

  // Redirected to the (fake) hosted checkout page, then back to /subscribe/return.
  await page.waitForURL(/__e2e__\/checkout\/session/, { timeout: 15_000 });
  await page.getByRole("link", { name: "Complete payment" }).click();

  await page.waitForURL(/\/subscribe\/return/, { timeout: 15_000 });
  await expect(page.getByText(/you.re subscribed/i)).toBeVisible({ timeout: 15_000 });

  // It now appears on /subscriptions as an active subscription.
  await page.goto("/subscriptions");
  const row = page.getByRole("listitem").filter({ hasText: "Supporter" });
  await expect(row.getByText("Active")).toBeVisible();
  await expect(row.getByText(/Supporter · \$5\.00 \/ month/)).toBeVisible();

  // Toggling "cancel at renewal" keeps access to the end of the paid period.
  await row.getByRole("switch", { name: /cancel .* at renewal/i }).click();
  await expect(row.getByText(/access until/i)).toBeVisible();
});

test("subscribing again to the same creator is blocked", async ({ page }) => {
  await signIn(page);
  await page.goto(`/c/${CREATOR_HANDLE}`);
  await page.getByRole("button", { name: "Subscribe" }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: /continue to checkout/i }).click();

  // The API returns 409; the UI routes to the existing subscription.
  await page.waitForURL(/\/subscriptions/, { timeout: 15_000 });
  await expect(page.getByText("Active").first()).toBeVisible();
});

test("payout onboarding: blocked pre-verification, then age gate, start, pending", async ({ page, request }) => {
  await signIn(page);
  await ensureFixtureIsCreator(page);

  await page.goto("/creator/payouts");
  await expect(page.getByText(/haven.t started payout onboarding/i)).toBeVisible();

  // POST /creators/me/payout-account requires a verified creator identity
  // (WEB PHASE 14 audit fix, apps/api/src/routes/payouts.ts) — an
  // unverified creator sees a pointer to /creator/verification instead of
  // the start flow, no checkbox or button at all.
  await expect(page.getByText(/identity verification required/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /start payout onboarding/i })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /identity verification/i })).toHaveAttribute(
    "href",
    "/creator/verification",
  );

  const verifyRes = await request.post("/api/__e2e__/verify-creator", { data: { did: FIXTURE_DID } });
  expect(verifyRes.ok()).toBeTruthy();
  await page.reload();
  await expect(page.getByText(/haven.t started payout onboarding/i)).toBeVisible();

  // "Start" is disabled until the 18+ self-declaration is checked.
  const start = page.getByRole("button", { name: /start payout onboarding/i });
  await expect(start).toBeDisabled();
  await page.getByRole("checkbox").check();
  await expect(start).toBeEnabled();

  // Start → (fake) hosted onboarding page → back to /creator/payouts, now pending.
  await start.click();
  await page.waitForURL(/__e2e__\/payout-onboarding\/onboarding/, { timeout: 15_000 });
  await page.getByRole("link", { name: "Finish onboarding" }).click();

  await page.waitForURL(/\/creator\/payouts/, { timeout: 15_000 });
  await expect(page.getByText(/pending verification/i)).toBeVisible();
  await expect(page.getByText(/keep publishing and taking subscriptions/i)).toBeVisible();
});
