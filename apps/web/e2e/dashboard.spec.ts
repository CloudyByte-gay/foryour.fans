import { expect, test, type Page } from "@playwright/test";

// Same fixture identity every other e2e spec in this suite uses
// (apps/api/test/e2e/fakeServer.ts). This file is named to sort right after
// creator.spec.ts and before discover/feed/media/posts/social/subscribe —
// see that file's own note on why ordering matters here: creator.spec.ts
// leaves the fixture as a creator with one (deactivated) tier, but nothing
// downstream has posted, subscribed, or started payout onboarding yet, so
// this file can rely on the dashboard being in its "no revenue yet, no
// posts yet" shape without racing any other spec for that state.
const HANDLE = "e2e-tester.test";

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Bluesky handle").fill(HANDLE);
  await page.getByRole("button", { name: /continue with at protocol/i }).click();
  await page.waitForURL(/\/dashboard(\?|$)/, { timeout: 15_000 });
}

async function ensureFixtureIsCreator(page: Page) {
  await page.goto("/become-a-creator");
  if (/\/c\//.test(page.url())) return;
  await page.getByLabel(/display name/i).fill("E2E Creator");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: /publish creator account/i }).click();
  await page.waitForURL(new RegExp(`/c/${HANDLE.replace(/\./g, "\\.")}$`), { timeout: 15_000 });
}

test.describe.configure({ mode: "serial" });

test("creator dashboard: stats, revenue gated behind payout onboarding, empty posts, date-range refetch", async ({ page }) => {
  await signIn(page);
  await ensureFixtureIsCreator(page);

  await page.goto("/creator/dashboard");
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();

  // Stat tiles render regardless of whether the fixture has any activity yet.
  await expect(page.getByText("Subscribers", { exact: true })).toBeVisible();
  await expect(page.getByText("Active subscriptions")).toBeVisible();
  await expect(page.getByText("New subscribers")).toBeVisible();
  await expect(page.getByText("Cancellations")).toBeVisible();

  // Payout onboarding hasn't started this early in the suite — revenue figures are gated.
  await expect(page.getByText(/complete payout onboarding to see earnings/i).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Complete payout onboarding" }).first()).toHaveAttribute(
    "href",
    "/creator/payouts",
  );

  // Both time-series charts are titled — one series each, so no legend needed.
  await expect(page.getByRole("heading", { name: "Subscribers over time" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "MRR over time" })).toBeVisible();

  // Nothing's been published yet.
  await expect(page.getByText("No posts yet")).toBeVisible();
  await expect(page.getByRole("link", { name: "New post" })).toBeVisible();

  // Changing the date range re-fetches without erroring.
  const sevenDays = page.getByRole("button", { name: "Last 7 days" });
  await sevenDays.click();
  await expect(sevenDays).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible();
  await expect(page.getByText("Subscribers", { exact: true })).toBeVisible();
});
