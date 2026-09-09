import { expect, test, type Page } from "@playwright/test";

// The fixture identity the fake API logs in (apps/api/test/e2e/fakeServer.ts).
// Every signIn re-syncs the fake profile, so the handle is always restored to
// this even if an earlier spec file renamed it.
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

/** Publishes a post through the composer and returns its id. */
async function composePost(page: Page, opts: { text: string; visibility: "Public" | "Subscribers" }) {
  await page.goto("/creator/posts/new");
  await page.getByLabel("Post", { exact: true }).fill(opts.text);
  await page.getByRole("radio", { name: opts.visibility, exact: true }).check();
  await page.getByRole("button", { name: "Publish" }).click();
  await page.waitForURL(/\/creator\/posts$/, { timeout: 15_000 });
  await expect(page.getByText(opts.text)).toBeVisible();
  const href = await page
    .getByRole("listitem")
    .filter({ hasText: opts.text })
    .getByRole("link", { name: /edit/i })
    .getAttribute("href");
  return href!.replace("/creator/posts/", "").replace("/edit", "");
}

test.describe.configure({ mode: "serial" });

test("compose a public post, then read it on the public permalink", async ({ page }) => {
  await signIn(page);
  await ensureFixtureIsCreator(page);

  const id = await composePost(page, { text: "Hello from the open network", visibility: "Public" });

  await page.goto(`/c/${HANDLE}/post/${id}`);
  await expect(page.getByText("Hello from the open network")).toBeVisible();
  await expect(page.getByText("Public")).toBeVisible();
});

// The e2e fake API wires the fixture creator to a CreatorOwnedContentRepository
// over an in-memory FakePds, so a PUBLIC post really is dual-published as
// app.bsky.feed.post + fans.foryour.post (prompts/bluesky-public-posts.md).
test("a public post is dual-published — one item, with a Bluesky affordance", async ({ page }) => {
  await signIn(page);
  await ensureFixtureIsCreator(page);

  const text = "Dual-published to Bluesky and foryour.fans";
  const id = await composePost(page, { text, visibility: "Public" });

  // Exactly one list row for this post.
  await expect(page.getByRole("listitem").filter({ hasText: text })).toHaveCount(1);

  // The permalink shows the Bluesky chip + a bsky.app link, and renders once.
  await page.goto(`/c/${HANDLE}/post/${id}`);
  await expect(page.getByText(text)).toHaveCount(1);
  await expect(page.getByText("Bluesky", { exact: true })).toBeVisible();
  const bskyLink = page.getByRole("link", { name: /view on bluesky/i });
  await expect(bskyLink).toBeVisible();
  expect(await bskyLink.getAttribute("href")).toMatch(/^https:\/\/bsky\.app\/profile\/.+\/post\//);
});

test("a subscriber-only post never claims Bluesky publication", async ({ page }) => {
  await signIn(page);
  await ensureFixtureIsCreator(page);
  await page.goto("/creator/posts/new");

  await page.getByRole("radio", { name: "Subscribers", exact: true }).check();
  await expect(page.getByTestId("grapheme-counter")).toBeHidden();
  await expect(page.getByText(/bluesky limit/i)).toBeHidden();
});

test("the Public warning shows only while Public is selected", async ({ page }) => {
  await signIn(page);
  await ensureFixtureIsCreator(page);
  await page.goto("/creator/posts/new");

  await expect(page.getByText(/replicated by other apps/i)).toBeHidden();
  await page.getByRole("radio", { name: "Public", exact: true }).check();
  await expect(page.getByText(/replicated by other apps/i)).toBeVisible();
  await page.getByRole("radio", { name: "Subscribers", exact: true }).check();
  await expect(page.getByText(/replicated by other apps/i)).toBeHidden();
});

test("a subscriber-only post is locked (no body text) for a logged-out viewer", async ({ page, context }) => {
  await signIn(page);
  await ensureFixtureIsCreator(page);

  const secret = "PRIVATE-BODY-should-never-render-42";
  const id = await composePost(page, { text: secret, visibility: "Subscribers" });

  await context.clearCookies();
  await page.goto(`/c/${HANDLE}/post/${id}`);

  await expect(page.getByText(/for E2E Creator's subscribers/i)).toBeVisible();
  await expect(page.getByRole("link", { name: /log in to subscribe/i })).toBeVisible();
  expect(await page.content()).not.toContain(secret);
});

test("edit and delete a post", async ({ page }) => {
  await signIn(page);
  await ensureFixtureIsCreator(page);

  const id = await composePost(page, { text: "draft wording", visibility: "Subscribers" });

  await page.goto(`/creator/posts/${id}/edit`);
  const textarea = page.getByLabel("Post", { exact: true });
  await expect(textarea).toHaveValue("draft wording");
  await textarea.fill("final wording");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.waitForURL(/\/creator\/posts$/, { timeout: 15_000 });
  await expect(page.getByText("final wording")).toBeVisible();

  await page
    .getByRole("listitem")
    .filter({ hasText: "final wording" })
    .getByRole("button", { name: /delete post/i })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Delete post" }).click();
  await expect(page.getByText("final wording")).toBeHidden();
});
