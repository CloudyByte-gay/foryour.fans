import { loadEnv, type Env } from "../src/config/env.js";

export function testEnv(overrides: Partial<NodeJS.ProcessEnv> = {}): Env {
  return loadEnv({
    DATABASE_URL: "postgresql://test",
    REDIS_URL: process.env.REDIS_URL ?? "redis://localhost:6379/15",
    NODE_ENV: "test",
    ...overrides,
  });
}
