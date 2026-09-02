import { defineConfig, devices } from "@playwright/test";

/*
 * End-to-end auth flow. Two servers are started:
 *  - a fake-OAuth API (apps/api/test/e2e/fakeServer.ts) reusing the same
 *    `buildApp` + fakes the API's own unit tests use, so login needs no real
 *    AT handle or interactive consent;
 *  - `next dev` for apps/web, proxying /api/* to that fake API.
 *
 * Real Postgres + Redis are required (docker compose, or CI service
 * containers) because sessions are stored server-side. CI wiring for this
 * suite is WEB PHASE 16.
 */
const WEB_PORT = 3210;
const API_PORT = 4210;
const PUBLIC_URL = `http://127.0.0.1:${WEB_PORT}`;

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://foryour_fans:foryour_fans@localhost:5432/foryour_fans";
const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379/15";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "list" : [["list"]],
  use: {
    baseURL: PUBLIC_URL,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "pnpm --filter @foryour-fans/api exec tsx test/e2e/fakeServer.ts",
      port: API_PORT,
      timeout: 60_000,
      reuseExistingServer: !process.env.CI,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        NODE_ENV: "test",
        HOST: "127.0.0.1",
        PORT: String(API_PORT),
        PUBLIC_URL,
        DATABASE_URL,
        REDIS_URL,
        ATPROTO_OAUTH_MODE: "loopback",
      },
    },
    {
      // Production build, not `next dev` — avoids first-hit compile races
      // that make the round-trip flaky, and matches how CI (WEB PHASE 16)
      // will run it.
      command: `pnpm exec next build && pnpm exec next start -p ${WEB_PORT}`,
      port: WEB_PORT,
      timeout: 240_000,
      reuseExistingServer: !process.env.CI,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        NODE_ENV: "production",
        API_INTERNAL_URL: `http://127.0.0.1:${API_PORT}`,
        NEXT_PUBLIC_SITE_URL: PUBLIC_URL,
      },
    },
  ],
});
