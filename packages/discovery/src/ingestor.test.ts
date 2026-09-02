import { randomUUID } from "node:crypto";
import { getPrismaClient, type PrismaClient } from "@foryour-fans/database";
import { NSID } from "@foryour-fans/lexicons";
import { WebSocketServer, type WebSocket as WsWebSocket } from "ws";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { JetstreamIngestor } from "./ingestor.js";
import type { ResolveDid } from "./indexer.js";

/**
 * Exercises the REAL `ws` client against a real local `WebSocketServer` —
 * not a mocked WebSocket class — so this test actually proves the
 * connect/subscribe/parse/index/cursor-persist loop works end to end, the
 * same "exercise the real transport, fake only what's genuinely external"
 * approach Phase 8 used for S3ObjectStorage. It's not a substitute for the
 * one-time manual live-Jetstream check documented in docs/architecture.md
 * (this test proves the client code is correct; that check is what
 * originally caught the wire-format/query-param discrepancies fixed in
 * jetstreamTypes.ts and ingestor.ts — see that check's transcript there).
 */

const prisma: PrismaClient = getPrismaClient();
const fakeResolveDid: ResolveDid = async (did) => ({ handle: `${did.slice(-8)}.test`, pdsUrl: "https://pds.example" });

function newDid(): string {
  return `did:plc:test${randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

function commitFrame(fields: { did: string; timeUs: number; collection: string; rkey: string; record: Record<string, unknown> }): string {
  return JSON.stringify({
    did: fields.did,
    time_us: fields.timeUs,
    cursor: fields.timeUs,
    kind: "commit",
    commit: { rev: "3mukjqx2sbm2f", operation: "create", collection: fields.collection, rkey: fields.rkey, record: fields.record },
  });
}

interface TestServer {
  wss: WebSocketServer;
  port: number;
  connections: Array<{ socket: WsWebSocket; url: string }>;
  close: () => Promise<void>;
}

async function startTestServer(): Promise<TestServer> {
  const wss = new WebSocketServer({ port: 0 });
  await new Promise<void>((resolve) => wss.once("listening", resolve));
  const address = wss.address();
  if (typeof address === "string" || !address) throw new Error("expected an AddressInfo");

  const connections: TestServer["connections"] = [];
  wss.on("connection", (socket, request) => {
    connections.push({ socket, url: request.url ?? "" });
  });

  return {
    wss,
    port: address.port,
    connections,
    close: () =>
      new Promise<void>((resolve, reject) => {
        wss.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

// ingestionCursor is a singleton-per-source table only ever touched by
// this file, so an unscoped clear here is safe. indexedCreatorProfile is
// NOT — it's shared with indexer.test.ts and discover.test.ts, which run
// in parallel (vitest runs different test files concurrently by default),
// so each test below cleans up its own specific did instead — see
// indexer.test.ts's cleanup() doc comment for the real bug this exact
// mistake caused during Phase 10 development.
afterEach(async () => {
  await prisma.ingestionCursor.deleteMany({});
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("JetstreamIngestor", () => {
  it("connects, applies a real commit message, and persists its cursor", async () => {
    const server = await startTestServer();
    const did = newDid();
    const events: Array<{ timeUs: number }> = [];

    const ingestor = new JetstreamIngestor({
      prisma,
      resolveDid: fakeResolveDid,
      url: `ws://127.0.0.1:${server.port}/subscribe`,
      collections: [NSID.profile],
      onEvent: (event) => events.push(event),
    });

    await ingestor.start();
    expect(server.connections).toHaveLength(1);
    // The subscribe URL carries the collections filter, under the real
    // (verified-against-the-live-server) param name — proves the client
    // actually sent Jetstream's real query params, not just that it can
    // open a socket.
    expect(server.connections[0]!.url).toContain(`wantedCollections=${encodeURIComponent(NSID.profile)}`);

    server.connections[0]!.socket.send(commitFrame({ did, timeUs: 100, collection: NSID.profile, rkey: "self", record: { displayName: "Real Test" } }));

    await new Promise<void>((resolve, reject) => {
      const start = Date.now();
      const check = () => {
        if (events.length > 0) return resolve();
        if (Date.now() - start > 5000) return reject(new Error("timed out waiting for onEvent"));
        setTimeout(check, 20);
      };
      check();
    });

    const row = await prisma.indexedCreatorProfile.findUniqueOrThrow({ where: { did } });
    expect(row.displayName).toBe("Real Test");

    const cursor = await prisma.ingestionCursor.findUniqueOrThrow({ where: { source: "jetstream" } });
    expect(cursor.cursor.toString()).toBe("100");

    ingestor.stop();
    await server.close();
    await prisma.indexedCreatorProfile.deleteMany({ where: { did } });
  });

  it("resumes from the persisted cursor on the next start()", async () => {
    await prisma.ingestionCursor.create({ data: { source: "jetstream", cursor: 555n } });

    const server = await startTestServer();
    const ingestor = new JetstreamIngestor({
      prisma,
      resolveDid: fakeResolveDid,
      url: `ws://127.0.0.1:${server.port}/subscribe`,
      collections: [NSID.profile],
    });

    await ingestor.start();
    expect(server.connections[0]!.url).toContain("cursor=555");

    ingestor.stop();
    await server.close();
  });

  it("stop() closes the connection without throwing", async () => {
    const server = await startTestServer();
    const ingestor = new JetstreamIngestor({
      prisma,
      resolveDid: fakeResolveDid,
      url: `ws://127.0.0.1:${server.port}/subscribe`,
      collections: [NSID.profile],
    });

    await ingestor.start();
    expect(() => ingestor.stop()).not.toThrow();

    await server.close();
  });

  it("silently ignores an unparseable message instead of crashing the connection", async () => {
    const server = await startTestServer();
    const errors: unknown[] = [];
    const events: Array<{ timeUs: number }> = [];
    const ingestor = new JetstreamIngestor({
      prisma,
      resolveDid: fakeResolveDid,
      url: `ws://127.0.0.1:${server.port}/subscribe`,
      collections: [NSID.profile],
      onEvent: (event) => events.push(event),
      onError: (error) => errors.push(error),
    });

    await ingestor.start();
    server.connections[0]!.socket.send("not valid json{{{");
    // Send a real, valid frame right after — if the bad message had
    // wedged the connection, this wouldn't be received either.
    const did = newDid();
    server.connections[0]!.socket.send(commitFrame({ did, timeUs: 200, collection: NSID.profile, rkey: "self", record: { displayName: "Still Works" } }));

    await new Promise<void>((resolve, reject) => {
      const start = Date.now();
      const check = () => {
        if (events.length > 0) return resolve();
        if (Date.now() - start > 5000) return reject(new Error("timed out"));
        setTimeout(check, 20);
      };
      check();
    });

    // parseJetstreamMessage returning null for the bad frame is not an
    // error path at all (see jetstreamTypes.ts) — onError should never
    // have fired.
    expect(errors).toHaveLength(0);

    const row = await prisma.indexedCreatorProfile.findUniqueOrThrow({ where: { did } });
    expect(row.displayName).toBe("Still Works");

    ingestor.stop();
    await server.close();
    await prisma.indexedCreatorProfile.deleteMany({ where: { did } });
  });
});
