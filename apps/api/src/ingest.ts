import "dotenv/config";
import { resolveDid } from "@foryour-fans/atproto";
import { JetstreamIngestor } from "@foryour-fans/discovery";
import { getPrismaClient } from "@foryour-fans/database";
import { BSKY_NSID, NSID } from "@foryour-fans/lexicons";
import pino from "pino";
import { loadEnv } from "./config/env.js";

/**
 * The Phase 10 ingestion process — see docs/architecture.md and
 * packages/discovery. Deliberately a SEPARATE entrypoint/process from
 * server.ts, run as `node dist/ingest.js` (or `pnpm ingest` in dev),
 * never started by the HTTP server: it's a long-lived Jetstream
 * WebSocket consumer, not a request handler, and running it inside every
 * HTTP-serving replica would mean N replicas independently re-consuming
 * the same firehose and racing to write the same index — see
 * docs/architecture.md's Phase 10 section for the full reasoning,
 * including why this doesn't need its own Kubernetes manifest until
 * Phase 16 (a known, documented gap).
 */

const env = loadEnv();
const prisma = getPrismaClient();
const log = pino({ level: env.NODE_ENV === "test" ? "silent" : env.LOG_LEVEL });

const collections = [
  NSID.profile,
  NSID.post,
  NSID.tier,
  // Bluesky-public-posts refactor — only when explicitly enabled (see
  // env.ts's INDEX_BSKY_POSTS doc comment for the firehose cost).
  ...(env.INDEX_BSKY_POSTS ? [BSKY_NSID.feedPost] : []),
];

const ingestor = new JetstreamIngestor({
  prisma,
  resolveDid,
  url: env.JETSTREAM_URL,
  collections,
  onEvent: (event) => log.info({ event }, "indexed a commit event"),
  onError: (error) => log.error({ err: error }, "ingestion error"),
});

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, "shutting down");
  try {
    ingestor.stop();
    await prisma.$disconnect();
    process.exit(0);
  } catch (error) {
    log.error(error, "error during shutdown");
    process.exit(1);
  }
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

log.info({ url: env.JETSTREAM_URL, collections }, "starting Jetstream ingestion");
await ingestor.start();
log.info("connected and subscribed");
