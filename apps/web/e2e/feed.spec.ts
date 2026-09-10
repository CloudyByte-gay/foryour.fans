import { expect, test, type Page } from "@playwright/test";

// The fixture identity the fake API logs in (apps/api/test/e2e/fakeServer.ts).
const HANDLE = "e2e-tester.test";

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Bluesky handle").fill(HANDLE);
  await page.getByRole("button", { name: /continue/i }).click();
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

/** Publishes a public post through the composer and returns its id. */
async function composePost(page: Page, text: string) {
  await page.goto("/creator/posts/new");
  await page.getByLabel("Post", { exact: true }).fill(text);
  await page.getByRole("radio", { name: "Public", exact: true }).check();
  await page.getByRole("button", { name: "Publish" }).click();
  await page.waitForURL(/\/creator\/posts$/, { timeout: 15_000 });
  await expect(page.getByText(text)).toBeVisible();
  const href = await page
    .getByRole("listitem")
    .filter({ hasText: text })
    .getByRole("link", { name: /edit/i })
    .getAttribute("href");
  return href!.replace("/creator/posts/", "").replace("/edit", "");
}

test.describe.configure({ mode: "serial" });

test("an anonymous visitor gets a logged-out explainer, not a redirect or an empty stream", async ({ page }) => {
  await page.goto("/feed");
  await expect(page).toHaveURL(/\/feed$/);
  await expect(page.getByRole("heading", { name: /your feed, once you're signed in/i })).toBeVisible();
  const main = page.getByRole("main");
  await expect(main.getByRole("link", { name: "Log in" })).toHaveAttribute("href", "/login?next=%2Ffeed");
  await expect(main.getByRole("link", { name: /browse creators/i })).toHaveAttribute("href", "/discover");
});

test("a signed-in visitor sees their public post in the home feed", async ({ page }) => {
  await signIn(page);
  await ensureFixtureIsCreator(page);

  const text = "Hello from the WEB PHASE 9 feed";
  await composePost(page, text);

  await page.goto("/feed");
  await expect(page.getByRole("heading", { name: "Feed", exact: true })).toBeVisible();
  await expect(page.getByText(text)).toBeVisible();
});

test("next/prev navigation moves between a creator's posts", async ({ page }) => {
  await signIn(page);
  await ensureFixtureIsCreator(page);

  const older = "PHASE 9 nav — older post";
  const newer = "PHASE 9 nav — newer post";
  const olderId = await composePost(page, older);
  await composePost(page, newer);

  await page.goto(`/c/${HANDLE}/post/${olderId}`);
  await expect(page.getByText(older)).toBeVisible();
  const newerLink = page.getByRole("link", { name: /newer/i });
  await expect(newerLink).toBeVisible();
  await newerLink.click();
  await expect(page.getByText(newer)).toBeVisible();

  const olderLink = page.getByRole("link", { name: /older/i });
  await expect(olderLink).toBeVisible();
  await olderLink.click();
  await expect(page.getByText(older)).toBeVisible();
});
