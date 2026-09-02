import { expect, test } from "@playwright/test";

const SLUG = "e2e-creator";

async function signIn(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("AT Protocol handle").fill("e2e-tester.test");
  await page.getByRole("button", { name: /continue with at protocol/i }).click();
  await page.waitForURL(/\/dashboard(\?|$)/, { timeout: 15_000 });
}

// The fake API wipes the fixture creator/user on boot, so this runs clean each
// `test:e2e` invocation. Serial: the second test depends on the first.
test.describe.configure({ mode: "serial" });

test("become a creator through the wizard, land on the public page as owner", async ({ page }) => {
  await signIn(page);
  await page.goto("/become-a-creator");

  // Step 1 — slug
  await page.getByLabel("Page slug").fill(SLUG);
  await expect(page.getByText(`/c/${SLUG} is available.`)).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: "Continue" }).click();

  // Step 2 — profile
  await page.getByLabel(/display name/i).fill("E2E Creator");
  await page.getByRole("button", { name: "Continue" }).click();

  // Step 3 — content rating (skip)
  await page.getByRole("button", { name: "Continue" }).click();

  // Step 4 — review & publish
  await expect(page.getByText(`/c/${SLUG}`)).toBeVisible();
  await page.getByRole("button", { name: /publish creator account/i }).click();

  await page.waitForURL(new RegExp(`/c/${SLUG}$`), { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "E2E Creator" })).toBeVisible();
  await expect(page.getByText(`@${SLUG}`)).toBeVisible();
  await expect(page.getByText("This is your page")).toBeVisible();
  // Owner sees the Edit affordance, not a Subscribe button.
  await expect(page.getByRole("link", { name: "Edit" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Subscribe" })).toHaveCount(0);
});

test("creator settings: edit profile, and the slug-change dialog warns about broken links", async ({
  page,
}) => {
  await signIn(page);

  // Already a creator now → /become-a-creator bounces to the page.
  await page.goto("/become-a-creator");
  await page.waitForURL(new RegExp(`/c/${SLUG}$`), { timeout: 15_000 });

  await page.goto("/creator/settings");
  await page.getByLabel(/bio/i).fill("Updated by the e2e test.");
  await page.getByRole("button", { name: /save & publish/i }).click();
  await expect(page.getByText(/published to your PDS/i)).toBeVisible({ timeout: 10_000 });

  await page.getByRole("button", { name: "Change slug" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText(/will break/i);
  await expect(dialog).toContainText(/once every 7 days/i);
  await dialog.getByRole("button", { name: "Cancel" }).click();
});
