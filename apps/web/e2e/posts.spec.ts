import { expect, test } from "@playwright/test";

// The fixture identity the fake API (apps/api/test/e2e/fakeServer.ts) logs in.
// Its content repository is a CreatorOwnedContentRepository over an in-memory
// FakePds, so a PUBLIC post really is dual-published (app.bsky.feed.post +
// fans.foryour.post) and the UI shows a "Bluesky" badge.
const HANDLE = "e2e-tester.test";

async function signIn(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("AT Protocol handle").fill(HANDLE);
  await page.getByRole("button", { name: /continue with at protocol/i }).click();
  await page.waitForURL(/\/dashboard(\?|$)/, { timeout: 15_000 });
}

test.describe.configure({ mode: "serial" });

const PAGE_RE = new RegExp(`/c/${HANDLE.replace(/\./g, "\\.")}$`);

test.beforeEach(async ({ page }) => {
  await signIn(page);
  await page.goto("/become-a-creator");
  // Already a creator (another spec, or a prior test here) → bounces straight
  // to the page. Otherwise complete the 3-step wizard so this spec stands
  // alone regardless of run order.
  const onWizard = await page
    .getByRole("button", { name: "Continue" })
    .isVisible()
    .catch(() => false);
  if (onWizard) {
    await page.getByLabel(/display name/i).fill("E2E Creator");
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: /publish creator account/i }).click();
  }
  await page.waitForURL(PAGE_RE, { timeout: 15_000 });
});

test("compose a public post — it publishes to Bluesky-compatible feeds and shows one card", async ({ page }) => {
  await page.goto("/creator/posts");
  await expect(page.getByText(/publishes to bluesky-compatible feeds/i)).toBeVisible();

  await page.getByRole("textbox", { name: "Post" }).fill("hello open network — read more at example.com");
  await page.getByRole("button", { name: /publish post/i }).click();

  const card = page.getByTestId("post-card").filter({ hasText: "hello open network — read more at example.com" });
  await expect(card).toBeVisible({ timeout: 10_000 });
  // One card, with both a Public and a Bluesky chip.
  await expect(card).toHaveCount(1);
  await expect(card.getByText("Public", { exact: true })).toBeVisible();
  await expect(card.getByText("Bluesky", { exact: true })).toBeVisible();
  await expect(card.getByRole("link", { name: /view on bluesky/i })).toBeVisible();

  // And it appears on the home feed exactly once.
  await page.goto("/feed");
  await expect(
    page.getByTestId("post-card").filter({ hasText: "hello open network — read more at example.com" }),
  ).toHaveCount(1);
});

test("the composer never claims Bluesky publication for a subscribers post", async ({ page }) => {
  await page.goto("/creator/posts");
  await page.getByRole("combobox").first().selectOption("SUBSCRIBERS");

  await expect(page.getByText(/is not published as a normal public bluesky post/i)).toBeVisible();
  await expect(page.getByText(/publishes to bluesky-compatible feeds/i)).toHaveCount(0);

  await page.getByRole("textbox", { name: "Post" }).fill("subscribers only, please");
  await expect(page.getByRole("button", { name: /publish post/i })).toHaveText(/post for subscribers/i);
  await page.getByRole("button", { name: /publish post/i }).click();

  const card = page.getByTestId("post-card").filter({ hasText: "subscribers only, please" });
  await expect(card).toBeVisible({ timeout: 10_000 });
  await expect(card.getByText("Subscriber-only")).toBeVisible();
  await expect(card.getByText("Bluesky", { exact: true })).toHaveCount(0);
  await expect(card.getByText("Public", { exact: true })).toHaveCount(0);
  await expect(card.getByRole("link", { name: /view on bluesky/i })).toHaveCount(0);
});
