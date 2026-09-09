import { expect, test, type Page } from "@playwright/test";

// Same fixture identity every other e2e spec in this suite uses
// (apps/api/test/e2e/fakeServer.ts).
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
  const href = await page
    .getByRole("listitem")
    .filter({ hasText: opts.text })
    .getByRole("link", { name: /edit/i })
    .getAttribute("href");
  return href!.replace("/creator/posts/", "").replace("/edit", "");
}

test.describe.configure({ mode: "serial" });

test("like a public post, then unlike it — count and pressed state track the toggle", async ({ page }) => {
  await signIn(page);
  await ensureFixtureIsCreator(page);
  const id = await composePost(page, { text: "Like me if you can", visibility: "Public" });

  await page.goto(`/c/${HANDLE}/post/${id}`);
  const likeButton = page.getByRole("button", { name: /^Like$/ });
  await expect(likeButton).toBeVisible();
  await expect(likeButton).toHaveAttribute("aria-pressed", "false");

  await likeButton.click();
  const likedButton = page.getByRole("button", { name: "1" });
  await expect(likedButton).toHaveAttribute("aria-pressed", "true");

  await likedButton.click();
  const unlikedAgain = page.getByRole("button", { name: /^Like$/ });
  await expect(unlikedAgain).toHaveAttribute("aria-pressed", "false");
});

test("post a comment and see it appear in the thread", async ({ page }) => {
  await signIn(page);
  await ensureFixtureIsCreator(page);
  const id = await composePost(page, { text: "Comment on this one", visibility: "Public" });

  await page.goto(`/c/${HANDLE}/post/${id}`);
  await expect(page.getByText(/no comments yet/i)).toBeVisible();

  await page.getByLabel("Add a comment").fill("Great post, thanks for sharing!");
  await page.getByRole("button", { name: /^Comment$/ }).click();

  await expect(page.getByText("Great post, thanks for sharing!")).toBeVisible();
  // The post's own creator authored it, so their comment is badged.
  await expect(page.getByText("Creator", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Add a comment")).toHaveValue("");
});

test("a locked post shows neither a like button nor a comment thread to a logged-out viewer", async ({
  page,
  context,
}) => {
  await signIn(page);
  await ensureFixtureIsCreator(page);
  const id = await composePost(page, { text: "Subscribers only body", visibility: "Subscribers" });

  await context.clearCookies();
  await page.goto(`/c/${HANDLE}/post/${id}`);

  await expect(page.getByText(/for E2E Creator's subscribers/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /^Like$/ })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Comments" })).toHaveCount(0);
});

test("a report entry point exists on a comment and files a real report", async ({ page, request }) => {
  await signIn(page);
  await ensureFixtureIsCreator(page);
  const id = await composePost(page, { text: "Report me not", visibility: "Public" });

  // The report/block affordance is hidden on the viewer's own comment
  // (components/post/CommentThread.tsx, WEB PHASE 14), so this seeds a
  // comment from the fake API's other fixture identity — there's no way to
  // sign in as it through the fake OAuth flow, which always logs the
  // browser in as the one fixture user.
  const seedRes = await request.post("/api/__e2e__/comments/seed", {
    data: { postId: id, text: "a comment to report" },
  });
  expect(seedRes.ok()).toBeTruthy();

  await page.goto(`/c/${HANDLE}/post/${id}`);
  await expect(page.getByText("a comment to report")).toBeVisible();

  // "Report comment" lives inside the per-comment "..." actions menu.
  await page.getByRole("button", { name: /actions for comment by/i }).click();
  await page.getByRole("menuitem", { name: /report comment/i }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Report this comment")).toBeVisible();
  await dialog.getByRole("button", { name: /submit report/i }).click();

  // WEB PHASE 14's reporting is real end-to-end (POST /reports), not a stub —
  // it never exposes case internals to the reporter, just a plain confirmation.
  // Radix Toast briefly renders a duplicate hidden `[aria-live]` announcement
  // of the same text (see creator.spec.ts's own note on this) — excluded here
  // the same way, to keep this a single-match locator.
  await expect(
    page.getByText("Report filed").and(page.locator(":not([aria-live])")),
  ).toBeVisible({ timeout: 10_000 });
});
