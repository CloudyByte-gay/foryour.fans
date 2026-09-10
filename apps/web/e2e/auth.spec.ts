import { expect, test } from "@playwright/test";

/**
 * Full round trip against the fake-OAuth API (see playwright.config.ts):
 * login → OAuth bounce → /auth/callback → dashboard → logout → home.
 */
test("sign in with an Bluesky handle, land on the dashboard, then log out", async ({ page }) => {
  await page.goto("/login");

  await expect(page.getByRole("heading", { name: "Log in" })).toBeVisible();

  await page.getByLabel("Bluesky handle").fill("e2e-tester.test");
  await page.getByRole("button", { name: /continue/i }).click();

  // start → fake authorize() → API callback → /auth/callback → /dashboard
  await page.waitForURL(/\/dashboard(\?|$)/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  // Brand-new account (no creator) gets the setup nudge.
  await expect(page.getByText(/signed in with your Bluesky identity/i)).toBeVisible();
  await expect(page.getByText("@e2e-tester.test")).toBeVisible();

  // Header shows the logged-in variant, not "Log in".
  await expect(page.getByRole("link", { name: "Log in" })).toHaveCount(0);

  await page.getByRole("button", { name: /^log out$/i }).click();

  await page.waitForURL(/\/$/, { timeout: 15_000 });
  await expect(page.getByRole("link", { name: "Log in" })).toBeVisible();
});

test("a cancelled authorization shows a friendly message, not a raw error", async ({ page }) => {
  await page.goto("/auth/callback?error=access_denied");

  await expect(page.getByRole("heading", { name: "Sign-in cancelled" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Back to sign in" })).toBeVisible();
});

test("an already-signed-in visitor to /login is redirected on", async ({ page }) => {
  // Sign in first.
  await page.goto("/login");
  await page.getByLabel("Bluesky handle").fill("e2e-tester.test");
  await page.getByRole("button", { name: /continue/i }).click();
  await page.waitForURL(/\/dashboard(\?|$)/, { timeout: 15_000 });

  // Now /login should bounce to the dashboard.
  await page.goto("/login?next=/dashboard");
  await page.waitForURL(/\/dashboard(\?|$)/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
});
