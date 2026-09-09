import { expect, test, type Page } from "@playwright/test";

/**
 * WEB PHASE 15 — the "dedicated mobile pass on feed, creator page,
 * composer, dashboard, admin" the phase calls out. Automated rather than a
 * one-off manual check: catches horizontal overflow at the 360px floor
 * cross-cutting requirement #7 sets, and keeps catching it on every future
 * change to these surfaces rather than only once.
 *
 * `zz-` prefix / signIn(): same filename-ordering reason as
 * zz-accessibility.spec.ts (see its own comment) — this file also drives
 * signIn/ensureFixtureIsCreator-adjacent navigation and must run after
 * auth.spec.ts/creator.spec.ts establish their own first-time-state
 * assumptions.
 */
const HANDLE = "e2e-tester.test";

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Bluesky handle").fill(HANDLE);
  await page.getByRole("button", { name: /continue with at protocol/i }).click();
  await page.waitForURL(/\/dashboard(\?|$)/, { timeout: 15_000 });
}

test.use({ viewport: { width: 360, height: 800 } });

async function checkNoHorizontalOverflow(page: Page, label: string) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, `${label} overflows horizontally at 360px`).toBeLessThanOrEqual(clientWidth);
}

test("360px viewport: no horizontal overflow on key surfaces", async ({ page }) => {
  await signIn(page);

  await page.goto("/feed");
  await checkNoHorizontalOverflow(page, "/feed");

  await page.goto(`/c/${HANDLE}`);
  await checkNoHorizontalOverflow(page, "/c/:handle");

  await page.goto("/creator/posts/new");
  await checkNoHorizontalOverflow(page, "/creator/posts/new (composer)");

  await page.goto("/creator/dashboard");
  await checkNoHorizontalOverflow(page, "/creator/dashboard");

  await page.goto("/admin/cases");
  await checkNoHorizontalOverflow(page, "/admin/cases");
});
