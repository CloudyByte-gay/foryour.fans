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
    // Explicit proxy IPs/CIDRs only. Unset means forwarding headers are untrusted.
    TRUSTED_PROXIES: z.string().default("").transform((value) => value.split(",").map((ip) => ip.trim()).filter(Boolean)),
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

    /**
     * Phase 15 (Production Hardening) — closes a gap `prompts/security-hardening.md`
     * flagged: `apps/api/src/server.ts` used to wire `new FakePaymentProvider()`
     * unconditionally, with no env-driven choice and no guard against it
     * running in production. `"fake"` is the only value that exists because
     * no real processor has been selected yet (see prompts/full.md's Phase 6
     * note — an adult-content-compatible processor is a business decision,
     * not something to invent here); the enum is written so a real provider
     * is a one-place addition later. The refine below is what actually
     * matters: it makes `NODE_ENV=production` with a fake provider a startup
     * failure, not a footgun, and is enforced unconditionally — see that
     * refine's own comment for why there is deliberately no break-glass
     * override.
     */
    PAYMENT_PROVIDER: z.enum(["fake"]).default("fake"),
    PAYOUT_PROVIDER: z.enum(["fake"]).default("fake"),

    /**
     * `prompts/security-hardening.md` §2 — the `FakePaymentProvider`'s
     * `handleWebhook` performs no signature verification (a real provider
     * would), so `POST /webhooks/fake` is an unauthenticated
     * subscription-status mutation primitive. The production refine below
     * already stops `PAYMENT_PROVIDER=fake` booting under
     * `NODE_ENV=production`, but `NODE_ENV=development` is a legitimate
     * deployed configuration (the staging overlay runs it against a real
     * public URL to exercise hosted AT OAuth). This flag lets such an
     * internet-reachable non-production deployment turn the forgeable route
     * off: when false, the route 404s for the fake provider exactly as it
     * does for an unknown one (see routes/webhooks.ts). Default true so
     * local dev / CI / the test suite keep working with zero extra config;
     * app.ts also ANDs it with `NODE_ENV !== "production"`, so its value is
     * moot in production (where a fake provider can't be selected anyway).
     */
    ALLOW_FAKE_WEBHOOKS: booleanEnvFlag(true),

    /**
     * Phase 14 (Trust and Safety) — comma-separated DIDs promoted to
     * `User.role: "ADMIN"` on login (apps/api/src/routes/auth.ts, via
     * packages/moderation/src/adminBootstrap.ts). Deliberately the ONLY way
     * to become an admin — there is no API route, self-service flow, or
     * peer-promotion path (see UserRole's doc comment in schema.prisma).
     * Empty by default: a fresh checkout has zero admins until an operator
     * sets this.
     */
    ADMIN_DIDS: z
      .string()
      .optional()
      .transform((value) => (value?.trim() ? value.split(",").map((did) => did.trim()).filter(Boolean) : [])),
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
  })
  // Phase 15 — prompts/security-hardening.md rule #1: "Fake payment and
  // payout providers must never be usable in production." No real
  // PaymentProvider/PayoutProvider exists yet (see PAYMENT_PROVIDER's doc
  // comment above), so this is, honestly, "production is not deployable for
  // real money yet" — which is the truth, not something to paper over with a
  // break-glass variable. When a real provider is added and the enum grows,
  // this refine keeps working unchanged; it only ever objects to "fake".
  .refine((env) => env.NODE_ENV !== "production" || env.PAYMENT_PROVIDER !== "fake", {
    message: "PAYMENT_PROVIDER=fake must never be used with NODE_ENV=production — no real payment provider is implemented yet.",
    path: ["PAYMENT_PROVIDER"],
  })
  .refine((env) => env.NODE_ENV !== "production" || env.PAYOUT_PROVIDER !== "fake", {
    message: "PAYOUT_PROVIDER=fake must never be used with NODE_ENV=production — no real payout provider is implemented yet.",
    path: ["PAYOUT_PROVIDER"],
  })
  // Phase 15 — prompts/security-hardening.md rule #5: creator-owned GATED
  // content stays disabled in production until a dedicated security review
  // approves it (see CREATOR_OWNED_GATED_CONTENT_ENABLED's own doc comment
  // above: offline ciphertext exposure risk, Spaces still alpha). This is
  // independent of the payment-provider refines above — a platform could in
  // principle reach production readiness for public content and subscriptions
  // before gated creator-owned content is reviewed.
  .refine((env) => env.NODE_ENV !== "production" || !env.CREATOR_OWNED_GATED_CONTENT_ENABLED, {
    message: "CREATOR_OWNED_GATED_CONTENT_ENABLED must never be true with NODE_ENV=production until a dedicated security review approves it.",
    path: ["CREATOR_OWNED_GATED_CONTENT_ENABLED"],
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
