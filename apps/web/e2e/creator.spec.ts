import { expect, test } from "@playwright/test";

// The fixture identity the fake API (apps/api/test/e2e/fakeServer.ts) logs in.
const HANDLE = "e2e-tester.test";
const FIXTURE_DID = "did:plc:teste2efakeuser00000000";

async function signIn(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("AT Protocol handle").fill(HANDLE);
  await page.getByRole("button", { name: /continue with at protocol/i }).click();
  await page.waitForURL(/\/dashboard(\?|$)/, { timeout: 15_000 });
}

// The fake API wipes the fixture creator/user on boot, so this runs clean each
// `test:e2e` invocation. Serial: later tests depend on the first.
test.describe.configure({ mode: "serial" });

test("become a creator through the wizard, land on the public page as owner", async ({ page }) => {
  await signIn(page);
  await page.goto("/become-a-creator");

  // Step 1 — profile (no slug step)
  await page.getByLabel(/display name/i).fill("E2E Creator");
  await page.getByRole("button", { name: "Continue" }).click();

  // Step 2 — content rating (skip)
  await page.getByRole("button", { name: "Continue" }).click();

  // Step 3 — review & publish. The page address is the session handle.
  await expect(page.getByText(`/c/${HANDLE}`).first()).toBeVisible();
  await page.getByRole("button", { name: /publish creator account/i }).click();

  await page.waitForURL(new RegExp(`/c/${HANDLE.replace(/\./g, "\\.")}$`), { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "E2E Creator" })).toBeVisible();
  await expect(page.getByText(`@${HANDLE}`)).toBeVisible();
  await expect(page.getByText("This is your page")).toBeVisible();
  // Owner sees the Edit affordance, not a Subscribe button.
  await expect(page.getByRole("link", { name: "Edit" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Subscribe" })).toHaveCount(0);
});

test("creator settings: edit profile; the page-address card is a static handle note, no slug dialog", async ({
  page,
}) => {
  await signIn(page);

  // Already a creator now → /become-a-creator bounces to the page.
  await page.goto("/become-a-creator");
  await page.waitForURL(new RegExp(`/c/${HANDLE.replace(/\./g, "\\.")}$`), { timeout: 15_000 });

  await page.goto("/creator/settings");
  await page.getByLabel(/bio/i).fill("Updated by the e2e test.");
  await page.getByRole("button", { name: /save & publish/i }).click();
  await expect(page.getByText(/published to your PDS/i)).toBeVisible({ timeout: 10_000 });

  // No slug-change dialog anymore — just a static note about the AT handle.
  await expect(page.getByRole("button", { name: "Change slug" })).toHaveCount(0);
  const card = page.getByText(/your page address follows your at protocol handle/i);
  await expect(card).toBeVisible();
  await expect(page.getByText(`/c/${FIXTURE_DID}`)).toBeVisible();
});

test("manage membership tiers: create → public card → edit price (grandfather callout) → deactivate", async ({
  page,
}) => {
  await signIn(page);
  await page.goto("/creator/tiers");
  await expect(page.getByText("No tiers yet")).toBeVisible();

  // Create a tier.
  await page.getByRole("button", { name: /new tier/i }).first().click();
  const createDialog = page.getByRole("dialog");
  await createDialog.getByLabel("Name").fill("Gold");
  await createDialog.getByLabel(/price \/ month/i).fill("9.99");
  await createDialog.getByRole("button", { name: "Create tier" }).click();
  await expect(createDialog).toBeHidden();
  await expect(page.getByText("Gold")).toBeVisible();

  // It renders as a public tier card. The owner viewing their own page gets
  // the "Manage tiers" affordance, not a Subscribe button (WEB PHASE 6).
  await page.goto(`/c/${HANDLE}`);
  await expect(page.getByRole("heading", { name: "Gold" })).toBeVisible();
  await expect(page.getByText("$9.99")).toBeVisible();
  await expect(page.getByRole("button", { name: "Subscribe" })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Manage tiers" })).toBeVisible();

  // Editing the price shows the grandfathering callout.
  await page.goto("/creator/tiers");
  await page.getByRole("button", { name: /^edit$/i }).click();
  const editDialog = page.getByRole("dialog");
  await editDialog.getByLabel(/price \/ month/i).fill("14.99");
  await expect(editDialog.getByText(/change what current subscribers pay/i)).toBeVisible();
  await editDialog.getByRole("button", { name: "Save changes" }).click();
  await expect(editDialog).toBeHidden();

  // Deactivating asks for confirmation, then moves the tier out of public view.
  await page.getByLabel("Deactivate Gold").click();
  const confirmDialog = page.getByRole("dialog");
  await expect(confirmDialog.getByText(/deactivated, not deleted/i)).toBeVisible();
  await confirmDialog.getByRole("button", { name: "Deactivate tier" }).click();
  await expect(page.getByRole("heading", { name: "Deactivated" })).toBeVisible();

  await page.goto(`/c/${HANDLE}`);
  await expect(page.getByText("No tiers yet")).toBeVisible();
});

test("a stale /c/<oldhandle> permanently redirects to the current handle", async ({ page, request }) => {
  const NEW_HANDLE = "e2e-renamed.test";

  // Simulate the creator changing their AT handle (what a re-login against a
  // PDS reporting a new handle does).
  const res = await request.post("/api/__e2e__/simulate-handle-change", {
    data: { did: FIXTURE_DID, newHandle: NEW_HANDLE },
  });
  expect(res.ok()).toBeTruthy();

  // The old address responds with a permanent (308) redirect to the new one...
  const raw = await request.get(`/c/${HANDLE}`, { maxRedirects: 0 });
  expect(raw.status()).toBe(308);
  expect(raw.headers()["location"]).toContain(`/c/${NEW_HANDLE}`);

  // ...and a browser following it lands on the new page.
  await page.goto(`/c/${HANDLE}`);
  await page.waitForURL(new RegExp(`/c/${NEW_HANDLE.replace(/\./g, "\\.")}$`), { timeout: 15_000 });
  await expect(page.getByText(`@${NEW_HANDLE}`)).toBeVisible();

  // The new address also resolves directly.
  await page.goto(`/c/${NEW_HANDLE}`);
  await expect(page.getByRole("heading", { name: "E2E Creator" })).toBeVisible();
});
