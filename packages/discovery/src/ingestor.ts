import type { PrismaClient } from "@foryour-fans/database";
import { WebSocket } from "ws";
import { applyCommitEvent, type ResolveDid } from "./indexer.js";
import { parseJetstreamMessage } from "./jetstreamTypes.js";

const INGESTION_SOURCE = "jetstream";
const INITIAL_RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 30_000;

export interface JetstreamIngestorConfig {
  prisma: PrismaClient;
  resolveDid: ResolveDid;
  /** e.g. "wss://jetstream.us-east.bsky.network/subscribe" — see docs/architecture.md's Phase 10 section for how this was verified against the real live endpoint. */
  url: string;
  /** NSID collections to filter the stream to (sent as `wantedCollections`, confirmed against the real server — see jetstreamTypes.ts) — see prompts/full.md PHASE 10 ("avoid operating a full Relay"): Jetstream's own server-side filter does that work for us. */
  collections: string[];
  /** Called after every successfully-applied event — tests use this to know when to assert, real usage is optional. */
  onEvent?: (event: { timeUs: number; collection: string; operation: string }) => void;
  onError?: (error: unknown) => void;
}

async function loadCursor(prisma: PrismaClient): Promise<string | undefined> {
  const row = await prisma.ingestionCursor.findUnique({ where: { source: INGESTION_SOURCE } });
  return row ? row.cursor.toString() : undefined;
}

async function saveCursor(prisma: PrismaClient, timeUs: number): Promise<void> {
  await prisma.ingestionCursor.upsert({
    where: { source: INGESTION_SOURCE },
    create: { source: INGESTION_SOURCE, cursor: BigInt(timeUs) },
    update: { cursor: BigInt(timeUs) },
  });
}

function buildSubscribeUrl(base: string, collections: string[], cursor: string | undefined): string {
  const url = new URL(base);
  for (const collection of collections) {
    url.searchParams.append("wantedCollections", collection);
  }
  if (cursor) {
    url.searchParams.set("cursor", cursor);
  }
  return url.toString();
}

/**
 * A resilient Jetstream client — connects, applies every parsed commit
 * event via applyCommitEvent, persists the resume cursor (the event's
 * `time_us`, unix microseconds — the portable, cross-instance resume
 * token per Jetstream's own docs, as opposed to the `cursor` integer the
 * wire payload also carries, which isn't documented as portable across
 * hosts) after each one, and reconnects with exponential backoff (capped
 * at 30s, reset on a successful connection) on any disconnect. `start()`
 * resolves once the first connection is open and subscribed; the
 * ingestion loop itself runs for the process's lifetime (or until
 * `stop()`), driven by the socket's own message events — this is meant to
 * run as its own long-lived process, not inside an HTTP request handler.
 * See apps/api/src/ingest.ts and docs/architecture.md's Phase 10 section
 * for why this is a second *process* within the apps/api deployable, not
 * bundled into server.ts.
 *
 * Deliberately does NOT subscribe to Jetstream's `identity` event kind
 * (handle-change notifications) — see docs/architecture.md for the
 * bandwidth/scoping tradeoff that decision documents; handle currency in
 * the index is refreshed opportunistically, on each commit event for a
 * DID, via `resolveDid`.
 */
export class JetstreamIngestor {
  private socket: WebSocket | null = null;
  private stopped = false;
  private reconnectDelayMs = INITIAL_RECONNECT_DELAY_MS;
  private connectedResolve: (() => void) | null = null;

  constructor(private readonly config: JetstreamIngestorConfig) {}

  async start(): Promise<void> {
    this.stopped = false;
    const connected = new Promise<void>((resolve) => {
      this.connectedResolve = resolve;
    });
    await this.connect();
    await connected;
  }

  stop(): void {
    this.stopped = true;
    this.socket?.close();
    this.socket = null;
  }

  private async connect(): Promise<void> {
    const cursor = await loadCursor(this.config.prisma);
    const url = buildSubscribeUrl(this.config.url, this.config.collections, cursor);
    const socket = new WebSocket(url);
    this.socket = socket;

    socket.on("open", () => {
      this.reconnectDelayMs = INITIAL_RECONNECT_DELAY_MS;
      this.connectedResolve?.();
      this.connectedResolve = null;
    });

    socket.on("message", (data) => {
      // Fire-and-forget: message events must stay synchronous from ws's
      // perspective, and one slow/failed event must never block the next
      // message from being received.
      void this.handleMessage(data.toString());
    });

    socket.on("error", (error) => {
      this.config.onError?.(error);
    });

    socket.on("close", () => {
      this.socket = null;
      if (this.stopped) return;
      const delay = this.reconnectDelayMs;
      this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, MAX_RECONNECT_DELAY_MS);
      setTimeout(() => {
        void this.connect();
      }, delay);
    });
  }

  private async handleMessage(raw: string): Promise<void> {
    const event = parseJetstreamMessage(raw);
    if (!event) return;

    try {
      await applyCommitEvent(this.config.prisma, this.config.resolveDid, event);
      await saveCursor(this.config.prisma, event.timeUs);
      this.config.onEvent?.({ timeUs: event.timeUs, collection: event.collection, operation: event.operation });
    } catch (error) {
      // One bad event (e.g. a transient DB error) must not take the
      // stream down — log via onError and keep consuming; the cursor
      // simply doesn't advance past this event, so a restart would retry
      // it rather than silently skip it.
      this.config.onError?.(error);
    }
  }
}
