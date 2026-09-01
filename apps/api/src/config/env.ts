import { z } from "zod";

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().positive().default(4000),
    HOST: z.string().default("0.0.0.0"),
    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
    REDIS_URL: z.string().min(1, "REDIS_URL is required"),
    CORS_ORIGIN: z.string().default("http://localhost:3000"),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

    /**
     * The single public origin the web app is served from. All AT OAuth
     * endpoints (client-metadata, jwks, callback) are proxied through it
     * under /api — see packages/atproto/src/oauthClient.ts.
     */
    PUBLIC_URL: z.string().url().default("http://127.0.0.1:3000"),
    ATPROTO_OAUTH_MODE: z.enum(["loopback", "hosted"]).default("loopback"),
    ATPROTO_OAUTH_PRIVATE_KEY: z.string().optional(),
  })
  .refine((env) => env.ATPROTO_OAUTH_MODE !== "hosted" || Boolean(env.ATPROTO_OAUTH_PRIVATE_KEY), {
    message: "ATPROTO_OAUTH_PRIVATE_KEY is required when ATPROTO_OAUTH_MODE=hosted",
    path: ["ATPROTO_OAUTH_PRIVATE_KEY"],
  })
  .refine((env) => env.ATPROTO_OAUTH_MODE !== "loopback" || env.NODE_ENV !== "production", {
    message: "ATPROTO_OAUTH_MODE=loopback must never be used with NODE_ENV=production",
    path: ["ATPROTO_OAUTH_MODE"],
  });

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}
