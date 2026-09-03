import { z } from "zod";

/**
 * A boolean env flag, parsed the way an env var actually needs to be:
 * `process.env` values are always strings or `undefined`, and
 * `z.coerce.boolean()` runs `Boolean(value)` on whatever string it's given
 * — so `CREATOR_OWNED_GATED_CONTENT_ENABLED=false` (a real, non-empty
 * string) coerces to `true`, silently defeating the exact "off by default
 * unless explicitly turned on" guarantee these flags exist for (see the
 * doc comments on CREATOR_OWNED_PDS_ENABLED/CREATOR_OWNED_GATED_CONTENT_ENABLED/
 * INDEX_BSKY_POSTS below, and .env.example, which all document "false" as
 * the safe default — a default that `z.coerce.boolean()` would have turned
 * on for anyone who literally copied `.env.example`). Found incidentally
 * while smoke-testing PHASE 12's exit checklist ("app starts"); fixed here
 * since it's a genuine, isolated correctness bug in shared env parsing, not
 * scope creep into Phase 12 itself. Case-insensitive; unset/empty falls
 * back to `defaultValue`; anything other than "true"/"1" is `false`.
 */
function booleanEnvFlag(defaultValue: boolean) {
  return z
    .string()
    .optional()
    .transform((value) => {
      const normalized = value?.trim().toLowerCase();
      if (!normalized) return defaultValue;
      return normalized === "true" || normalized === "1";
    });
}

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

    /**
     * S3-compatible private object storage for media (Phase 8) — see
     * packages/media. Defaults match infrastructure/docker/docker-compose.yml's
     * local MinIO so a fresh checkout works with zero config; production
     * points these at a real bucket (Cloudflare R2, GCS's S3-compatible
     * endpoint, or AWS S3 itself — S3ObjectStorage is written against the
     * S3 API, not any one vendor's SDK, so only these values change).
     */
    S3_ENDPOINT: z.string().url().default("http://localhost:9000"),
    S3_REGION: z.string().default("us-east-1"),
    S3_ACCESS_KEY_ID: z.string().default("foryour_fans"),
    S3_SECRET_ACCESS_KEY: z.string().default("foryour_fans_dev"),
    S3_BUCKET: z.string().default("foryour-fans-dev"),
    /** MinIO/most non-AWS S3-compatible providers require this; see S3ObjectStorageConfig's doc comment. */
    S3_FORCE_PATH_STYLE: booleanEnvFlag(true),

    /**
     * Phase 10's AT-network ingestion source — see packages/discovery and
     * apps/api/src/ingest.ts. Defaults to a real public Jetstream v2
     * instance (bsky.network's own recommended endpoint for new
     * projects, per its docs) — only read by the separate `ingest`
     * process, never by `server.ts`.
     */
    JETSTREAM_URL: z.string().url().default("wss://jetstream.us-east.bsky.network/subscribe"),

    /**
     * Bluesky-public-posts refactor (prompts/bluesky-public-posts.md,
     * docs/bluesky-public-posts.md §6). When true, the `ingest` process also
     * subscribes to `app.bsky.feed.post` so the paired Bluesky copy of a
     * dual-published public post is indexed. OFF by default: `wantedCollections`
     * can't scope to a DID, so this means ingesting the whole Bluesky firehose
     * — the indexer still drops any event for a DID this app doesn't already
     * track, but the bandwidth cost is real. Only read by `ingest.ts`.
     */
    INDEX_BSKY_POSTS: booleanEnvFlag(false),

    /**
     * Creator-owned PDS rearchitecture (prompts/creator-owned-pds.md,
     * docs/creator-owned-pds.md).
     *
     * `CREATOR_OWNED_PDS_ENABLED`: use CreatorOwnedContentRepository instead
     * of PrivateContentRepository — public posts become dual-published,
     * creator-PDS-authoritative records; Postgres a rebuildable cache. OFF
     * by default so Phases 1–10 behaviour is unchanged until the privacy
     * review signs off.
     *
     * `CREATOR_OWNED_GATED_CONTENT_ENABLED`: additionally write GATED
     * (subscriber/tier) post bodies to the creator's PDS, AES-256-GCM-
     * encrypted, with the key-grant flow. OFF by default — encrypted-blob-
     * on-PDS is not production-safe yet (offline attack on firehose-archived
     * ciphertext; Spaces still alpha — see docs/creator-owned-pds.md §4/§7).
     * Requires CONTENT_KEY_WRAP_SECRET. Requires CREATOR_OWNED_PDS_ENABLED.
     *
     * `CONTENT_KEY_WRAP_SECRET`: ≥16 chars; envelope-wraps per-post content
     * keys at rest. Treat like a signing key — a leak plus archived
     * ciphertext compromises every gated post.
     */
    CREATOR_OWNED_PDS_ENABLED: booleanEnvFlag(false),
    CREATOR_OWNED_GATED_CONTENT_ENABLED: booleanEnvFlag(false),
    CONTENT_KEY_WRAP_SECRET: z.string().min(16).optional(),
  })
  .refine(
    (env) => !env.CREATOR_OWNED_GATED_CONTENT_ENABLED || env.CREATOR_OWNED_PDS_ENABLED,
    {
      message: "CREATOR_OWNED_GATED_CONTENT_ENABLED requires CREATOR_OWNED_PDS_ENABLED",
      path: ["CREATOR_OWNED_GATED_CONTENT_ENABLED"],
    },
  )
  .refine(
    (env) => !env.CREATOR_OWNED_GATED_CONTENT_ENABLED || Boolean(env.CONTENT_KEY_WRAP_SECRET),
    {
      message: "CONTENT_KEY_WRAP_SECRET is required when CREATOR_OWNED_GATED_CONTENT_ENABLED=true",
      path: ["CONTENT_KEY_WRAP_SECRET"],
    },
  )
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
