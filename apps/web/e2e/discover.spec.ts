import { expect, test } from "@playwright/test";

// Seeded by apps/api/test/e2e/fakeServer.ts: a registered creator with one
// active $5/mo tier, indexed (so GET /discover and GET /search — which read
// only `indexed_creator_profiles`, never `Creator` directly — actually
// return it).
const OTHER_HANDLE = "e2e-creator.test";

test("/discover shows the seeded creator, enriched with a tier count and from-price, linking to /c/:handle", async ({ page }) => {
  await page.goto("/discover");
  await expect(page.getByRole("heading", { name: "Discover creators" })).toBeVisible();

  const card = page.getByRole("link", { name: /E2E Creator Two/i });
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute("href", `/c/${OTHER_HANDLE}`);
  await expect(card.getByText("1 tier")).toBeVisible();
  await expect(card.getByText(/From \$5\.00\/mo/)).toBeVisible();

  await card.click();
  await expect(page).toHaveURL(new RegExp(`/c/${OTHER_HANDLE}$`));
});

test("typing in the search box filters results and shows a no-results state for a non-match", async ({ page }) => {
  await page.goto("/discover");
  const searchBox = page.getByLabel("Search creators");

  await searchBox.fill("E2E Creator Two");
  await expect(page).toHaveURL(/\/search\?q=/);
  await expect(page.getByRole("link", { name: /E2E Creator Two/i })).toBeVisible();

  await searchBox.fill("zzz-no-such-creator-zzz");
  await expect(page.getByText(/no creators found/i)).toBeVisible();
  await expect(page.getByRole("link", { name: /E2E Creator Two/i })).toHaveCount(0);
});

test("/search deep-links a query server-side", async ({ page }) => {
  await page.goto(`/search?q=${encodeURIComponent("e2e-creator")}`);
  await expect(page.getByRole("heading", { name: "Search creators" })).toBeVisible();
  await expect(page.getByRole("link", { name: /E2E Creator Two/i })).toBeVisible();
});
