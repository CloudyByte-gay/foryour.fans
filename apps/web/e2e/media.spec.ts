import { expect, test, type Page } from "@playwright/test";

const HANDLE = "e2e-tester.test";

// A 1x1 transparent PNG.
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("AT Protocol handle").fill(HANDLE);
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

/** Composes a post with one uploaded image and returns its id. */
async function composeWithImage(page: Page, opts: { text: string; visibility: "Public" | "Subscribers" }) {
  await page.goto("/creator/posts/new");
  await page.getByLabel("Post", { exact: true }).fill(opts.text);
  await page.getByRole("radio", { name: opts.visibility, exact: true }).check();

  await page.setInputFiles('input[type="file"]', { name: "pixel.png", mimeType: "image/png", buffer: PNG_BYTES });
  // The composer blocks publishing until the attachment is READY.
  await expect(page.getByText(/^Ready/)).toBeVisible({ timeout: 15_000 });

  await page.getByRole("button", { name: "Publish" }).click();
  await page.waitForURL(/\/creator\/posts$/, { timeout: 15_000 });

  const href = await page
    .getByRole("listitem")
    .filter({ hasText: opts.text })
    .getByRole("link", { name: /edit/i })
    .getAttribute("href");
  return href!.replace("/creator/posts/", "").replace("/edit", "");
}

test.describe.configure({ mode: "serial" });

test("upload an image in the composer and view it on a public post", async ({ page, context }) => {
  await signIn(page);
  await ensureFixtureIsCreator(page);

  const id = await composeWithImage(page, { text: "post with a picture", visibility: "Public" });

  await page.goto(`/c/${HANDLE}/post/${id}`);
  await expect(page.getByTestId("media-gallery")).toBeVisible();
  const image = page.getByTestId("media-gallery").getByRole("button").first();
  await expect(image).toBeVisible({ timeout: 15_000 });
  // The <img> inside actually loaded its signed URL.
  await expect
    .poll(() => page.locator('[data-testid="media-gallery"] img').first().evaluate((el: HTMLImageElement) => el.naturalWidth))
    .toBeGreaterThan(0);

  // Still loads for a logged-out viewer — a PUBLIC post's media is public.
  await context.clearCookies();
  await page.goto(`/c/${HANDLE}/post/${id}`);
  await expect
    .poll(() => page.locator('[data-testid="media-gallery"] img').first().evaluate((el: HTMLImageElement) => el.naturalWidth))
    .toBeGreaterThan(0);
});

test("a subscriber-only post's media is not exposed to a logged-out viewer", async ({ page, context }) => {
  await signIn(page);
  await ensureFixtureIsCreator(page);

  const secret = "MEDIA-SECRET-body-should-not-render";
  const id = await composeWithImage(page, { text: secret, visibility: "Subscribers" });

  await context.clearCookies();
  await page.goto(`/c/${HANDLE}/post/${id}`);

  // Locked treatment, no gallery, no body.
  await expect(page.getByText(/for E2E Creator's subscribers/i)).toBeVisible();
  await expect(page.getByTestId("media-gallery")).toHaveCount(0);
  expect(await page.content()).not.toContain(secret);
});
