import { randomUUID } from "node:crypto";
import { getPrismaClient, type PrismaClient } from "@foryour-fans/database";
import { NSID } from "@foryour-fans/lexicons";
import { afterAll, describe, expect, it } from "vitest";
import { applyCommitEvent, type ResolveDid } from "./indexer.js";
import type { CommitEvent } from "./jetstreamTypes.js";

const prisma: PrismaClient = getPrismaClient();

function newDid(): string {
  return `did:plc:test${randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

const fakeResolveDid: ResolveDid = async (did) => ({ handle: `${did.slice(-8)}.test`, pdsUrl: "https://pds.example" });

function commit(overrides: Partial<CommitEvent> & Pick<CommitEvent, "did" | "collection" | "operation" | "rkey">): CommitEvent {
  return {
    timeUs: Date.now() * 1000,
    ...overrides,
  };
}

/**
 * Scoped to one `did`, never a blanket `deleteMany({})` — these tables are
 * shared across this file, discover.test.ts, and ingestor.test.ts, and
 * vitest runs different test *files* in parallel by default. An unscoped
 * deleteMany in one file's afterEach can wipe rows a concurrently-running
 * test in another file hasn't finished asserting on yet — a real bug this
 * exact mistake caused during Phase 10 development (see
 * docs/architecture.md), the same category of cross-file interference as
 * Phase 6's handle-collision bug, just via deletion instead of creation
 * this time.
 */
async function cleanup(did: string): Promise<void> {
  await prisma.indexedCreatorProfile.deleteMany({ where: { did } });
  await prisma.indexedPost.deleteMany({ where: { did } });
  await prisma.indexedTier.deleteMany({ where: { did } });
}

afterAll(async () => {
  await prisma.$disconnect();
});

describe("applyCommitEvent — fans.foryour.profile", () => {
  it("create upserts an IndexedCreatorProfile, resolving the handle live", async () => {
    const did = newDid();
    await applyCommitEvent(
      prisma,
      fakeResolveDid,
      commit({
        did,
        collection: NSID.profile,
        operation: "create",
        rkey: "self",
        record: { displayName: "Alice", bio: "hello", website: "https://alice.example", createdAt: "2026-01-01T00:00:00Z" },
      }),
    );

    const row = await prisma.indexedCreatorProfile.findUniqueOrThrow({ where: { did } });
    expect(row).toMatchObject({ displayName: "Alice", bio: "hello", website: "https://alice.example" });
    expect(row.handle).toBe(`${did.slice(-8)}.test`);
    expect(row.atCreatedAt).toEqual(new Date("2026-01-01T00:00:00Z"));

    await cleanup(did);
  });

  it("update overwrites an existing profile's fields", async () => {
    const did = newDid();
    await applyCommitEvent(
      prisma,
      fakeResolveDid,
      commit({ did, collection: NSID.profile, operation: "create", rkey: "self", record: { displayName: "Alice" } }),
    );
    await applyCommitEvent(
      prisma,
      fakeResolveDid,
      commit({ did, collection: NSID.profile, operation: "update", rkey: "self", record: { displayName: "Alice V2" } }),
    );

    const row = await prisma.indexedCreatorProfile.findUniqueOrThrow({ where: { did } });
    expect(row.displayName).toBe("Alice V2");
    expect(await prisma.indexedCreatorProfile.count({ where: { did } })).toBe(1);

    await cleanup(did);
  });

  it("delete removes the indexed profile", async () => {
    const did = newDid();
    await applyCommitEvent(
      prisma,
      fakeResolveDid,
      commit({ did, collection: NSID.profile, operation: "create", rkey: "self", record: { displayName: "Alice" } }),
    );
    await applyCommitEvent(prisma, fakeResolveDid, commit({ did, collection: NSID.profile, operation: "delete", rkey: "self" }));

    expect(await prisma.indexedCreatorProfile.findUnique({ where: { did } })).toBeNull();

    await cleanup(did);
  });

  it("handles a profile record with no fields at all (none are required by the lexicon)", async () => {
    const did = newDid();
    await applyCommitEvent(prisma, fakeResolveDid, commit({ did, collection: NSID.profile, operation: "create", rkey: "self", record: {} }));

    const row = await prisma.indexedCreatorProfile.findUniqueOrThrow({ where: { did } });
    expect(row.displayName).toBeNull();
    expect(row.atCreatedAt).toBeNull();

    await cleanup(did);
  });
});

describe("applyCommitEvent — fans.foryour.post", () => {
  it("create upserts an IndexedPost keyed by its at:// uri", async () => {
    const did = newDid();
    await applyCommitEvent(
      prisma,
      fakeResolveDid,
      commit({ did, collection: NSID.post, operation: "create", rkey: "abc123", record: { text: "hello world", createdAt: "2026-01-01T00:00:00Z" } }),
    );

    const uri = `at://${did}/${NSID.post}/abc123`;
    const row = await prisma.indexedPost.findUniqueOrThrow({ where: { uri } });
    expect(row).toMatchObject({ did, text: "hello world" });

    await cleanup(did);
  });

  it("skips a post record missing the required text field", async () => {
    const did = newDid();
    await applyCommitEvent(prisma, fakeResolveDid, commit({ did, collection: NSID.post, operation: "create", rkey: "abc123", record: {} }));

    expect(await prisma.indexedPost.count({ where: { did } })).toBe(0);

    await cleanup(did);
  });

  it("delete removes the indexed post", async () => {
    const did = newDid();
    await applyCommitEvent(
      prisma,
      fakeResolveDid,
      commit({ did, collection: NSID.post, operation: "create", rkey: "abc123", record: { text: "hello", createdAt: "2026-01-01T00:00:00Z" } }),
    );
    await applyCommitEvent(prisma, fakeResolveDid, commit({ did, collection: NSID.post, operation: "delete", rkey: "abc123" }));

    const uri = `at://${did}/${NSID.post}/abc123`;
    expect(await prisma.indexedPost.findUnique({ where: { uri } })).toBeNull();

    await cleanup(did);
  });
});

describe("applyCommitEvent — fans.foryour.tier", () => {
  it("create upserts an IndexedTier", async () => {
    const did = newDid();
    await applyCommitEvent(
      prisma,
      fakeResolveDid,
      commit({
        did,
        collection: NSID.tier,
        operation: "create",
        rkey: "xyz789",
        record: { name: "Gold", monthlyPrice: 1000, currency: "usd", sortOrder: 1, createdAt: "2026-01-01T00:00:00Z" },
      }),
    );

    const uri = `at://${did}/${NSID.tier}/xyz789`;
    const row = await prisma.indexedTier.findUniqueOrThrow({ where: { uri } });
    expect(row).toMatchObject({ name: "Gold", monthlyPrice: 1000, currency: "usd", sortOrder: 1 });

    await cleanup(did);
  });

  it("delete removes the indexed tier", async () => {
    const did = newDid();
    await applyCommitEvent(
      prisma,
      fakeResolveDid,
      commit({ did, collection: NSID.tier, operation: "create", rkey: "xyz789", record: { name: "Gold", createdAt: "2026-01-01T00:00:00Z" } }),
    );
    await applyCommitEvent(prisma, fakeResolveDid, commit({ did, collection: NSID.tier, operation: "delete", rkey: "xyz789" }));

    const uri = `at://${did}/${NSID.tier}/xyz789`;
    expect(await prisma.indexedTier.findUnique({ where: { uri } })).toBeNull();

    await cleanup(did);
  });
});

describe("applyCommitEvent — unrelated collections", () => {
  it("is a no-op for a collection outside the three fans.foryour.* types", async () => {
    const did = newDid();
    await applyCommitEvent(
      prisma,
      fakeResolveDid,
      commit({ did, collection: "app.bsky.feed.post", operation: "create", rkey: "abc123", record: { text: "unrelated" } }),
    );

    expect(await prisma.indexedPost.count({ where: { did } })).toBe(0);
    expect(await prisma.indexedCreatorProfile.count({ where: { did } })).toBe(0);

    await cleanup(did);
  });
});
