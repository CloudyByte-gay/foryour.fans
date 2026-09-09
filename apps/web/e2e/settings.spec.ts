import { expect, test } from "@playwright/test";

async function signIn(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Bluesky handle").fill("e2e-tester.test");
  await page.getByRole("button", { name: /continue with at protocol/i }).click();
  await page.waitForURL(/\/dashboard(\?|$)/, { timeout: 15_000 });
}

test("settings: immutable DID is shown and the theme control switches the theme", async ({ page }) => {
  await signIn(page);

  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.getByText("did:plc:teste2efakeuser00000000")).toBeVisible();
  await expect(page.getByText(/immutable/i)).toBeVisible();
  await expect(page.getByRole("button", { name: "Copy DID" })).toBeVisible();

  await page.getByRole("tab", { name: "Appearance" }).click();
  await page.getByRole("radio", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveClass(/dark/);
  await expect(page.getByRole("radio", { name: "Dark" })).toHaveAttribute("aria-checked", "true");

  // Notifications channels are present but disabled (not wired yet).
  await page.getByRole("tab", { name: "Notifications" }).click();
  await expect(page.getByRole("switch").first()).toBeDisabled();
});

test("settings is gated: anonymous visitors are sent to login", async ({ page }) => {
  await page.context().clearCookies();
  await page.goto("/settings");
  await page.waitForURL(/\/login\?next=%2Fsettings/, { timeout: 15_000 });
});
