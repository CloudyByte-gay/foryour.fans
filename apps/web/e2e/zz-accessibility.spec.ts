import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

// The fixture identity the fake API logs in (apps/api/test/e2e/fakeServer.ts).
const HANDLE = "e2e-tester.test";
const CREATOR_HANDLE = "e2e-creator.test";

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

async function composePost(page: Page, opts: { text: string; visibility: "Public" | "Subscribers" }) {
  await page.goto("/creator/posts/new");
  // exact: true — once the fixture creator is verified (e.g. subscribe.spec.ts's
  // payout-onboarding test, which runs before this file), PostComposer also
  // renders a "This post contains adult content" checkbox whose accessible
  // name contains "post", so a substring getByLabel("Post") match becomes
  // ambiguous.
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

/**
 * WEB PHASE 15 — automated screen-reader-relevant smoke test (axe-core) for
 * the "core flows" the phase's accessibility task calls out: login,
 * subscribe, view a locked post, and comment.
 *
 * `zz-` prefix is deliberate: this suite (single worker, one shared fake-API
 * database across every spec file, run in filename order — see
 * playwright.config.ts) treats the fixture identity as cumulative state
 * built up file by file. creator.spec.ts's own first test specifically
 * exercises the "become a creator" wizard and needs the fixture to still be
 * a brand-new, non-creator account when IT runs; auth.spec.ts's first test
 * has its own "just signed in for the first time" assumptions. This file's
 * tests call ensureFixtureIsCreator/signIn too, so it has to run after both
 * of those establish their own state, not before — hence sorting last.
 *
 * This checks the same things a
 * screen reader depends on (name/role/value on every control, valid ARIA,
 * label associations, landmark structure, color contrast) far more
 * exhaustively and repeatably than a one-off manual pass — see
 * docs/web-accessibility.md for what this suite does and doesn't cover
 * (it can't check whether the reading ORDER makes sense, or whether prose
 * is genuinely helpful out of context — those still need a real screen
 * reader).
 *
 * `disableRules(["duplicate-id"])` isn't used anywhere here on purpose —
 * every scan is expected to be fully clean, not just clean of the rules it's
 * convenient to ignore.
 */
test.describe.configure({ mode: "serial" });

test("login page has no automatically-detectable accessibility violations", async ({ page }) => {
  await page.goto("/login");
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test("subscribe flow: creator page and the review dialog are clean", async ({ page }) => {
  await signIn(page);

  // Doesn't complete the checkout — this file runs before subscribe.spec.ts
  // (alphabetical spec order under this suite's single-worker, serial-per-
  // file setup) and a completed subscription here would leave the fixture
  // already subscribed to CREATOR_HANDLE, breaking that file's own first
  // test (which expects a clean, not-yet-subscribed state). Escape closes
  // the dialog with no side effects.
  await page.goto(`/c/${CREATOR_HANDLE}`);
  await expect(page.getByRole("heading", { name: "Supporter" })).toBeVisible();
  let results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);

  await page.getByRole("button", { name: "Subscribe" }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  // The dialog's 160ms entrance animation (animate-slide-up-fade) fades in
  // opacity — scanning mid-animation makes axe see a partially-transparent
  // (and so falsely low-contrast) version of fully-opaque text. Outlasting
  // it avoids that false positive.
  await page.waitForTimeout(250);
  results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);

  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
});

test("a locked (subscribers-only) post is clean for both a logged-out and an entitled viewer", async ({
  page,
  context,
}) => {
  await signIn(page);
  await ensureFixtureIsCreator(page);
  const id = await composePost(page, { text: "Accessibility: locked post body", visibility: "Subscribers" });

  // Logged out — the locked state itself (no body, no like/comment UI).
  await context.clearCookies();
  await page.goto(`/c/${HANDLE}/post/${id}`);
  await expect(page.getByText(/for E2E Creator's subscribers/i)).toBeVisible();
  let results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);

  // The owner (entitled by ownership, same as any subscriber would be) sees
  // the full unlocked article + comment thread.
  await signIn(page);
  await page.goto(`/c/${HANDLE}/post/${id}`);
  await expect(page.getByText("Accessibility: locked post body")).toBeVisible();
  results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});

test("commenting on a post — empty thread, composer, and a posted comment are clean", async ({ page }) => {
  await signIn(page);
  await ensureFixtureIsCreator(page);
  const id = await composePost(page, { text: "Accessibility: comment on this", visibility: "Public" });

  await page.goto(`/c/${HANDLE}/post/${id}`);
  await expect(page.getByText(/no comments yet/i)).toBeVisible();
  let results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);

  await page.getByLabel("Add a comment").fill("An accessible comment, hopefully.");
  await page.getByRole("button", { name: /^Comment$/ }).click();
  await expect(page.getByText("An accessible comment, hopefully.")).toBeVisible();
  results = await new AxeBuilder({ page }).analyze();
  expect(results.violations).toEqual([]);
});
