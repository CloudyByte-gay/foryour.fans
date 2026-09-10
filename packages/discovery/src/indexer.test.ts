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
  await prisma.indexedLike.deleteMany({ where: { did } });
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
  it("is a no-op for a collection this indexer doesn't handle", async () => {
    const did = newDid();
    await applyCommitEvent(
      prisma,
      fakeResolveDid,
      commit({ did, collection: "app.bsky.feed.repost", operation: "create", rkey: "abc123", record: { subject: {} } }),
    );

    expect(await prisma.indexedPost.count({ where: { did } })).toBe(0);
    expect(await prisma.indexedCreatorProfile.count({ where: { did } })).toBe(0);
    expect(await prisma.indexedLike.count({ where: { did } })).toBe(0);

    await cleanup(did);
  });
});

describe("applyCommitEvent — fans.foryour.like", () => {
  const subjectUri = "at://did:plc:creator0000000000000000/fans.foryour.post/p1";

  it("create upserts an IndexedLike keyed by the like record's URI", async () => {
    const did = newDid();
    await applyCommitEvent(
      prisma,
      fakeResolveDid,
      commit({
        did,
        collection: NSID.like,
        operation: "create",
        rkey: "l1",
        cid: "bafylike",
        record: { subject: { uri: subjectUri, cid: "bafypost" }, createdAt: "2026-09-10T00:00:00Z" },
      }),
    );

    const row = await prisma.indexedLike.findUniqueOrThrow({ where: { uri: `at://${did}/${NSID.like}/l1` } });
    expect(row).toMatchObject({
      did,
      collection: NSID.like,
      subjectUri,
      subjectCid: "bafypost",
    });
    expect(row.atCreatedAt?.toISOString()).toBe("2026-09-10T00:00:00.000Z");

    await cleanup(did);
  });

  it("a second create for the same URI is an upsert, not a duplicate", async () => {
    const did = newDid();
    const ev = commit({
      did,
      collection: NSID.like,
      operation: "create",
      rkey: "l2",
      record: { subject: { uri: subjectUri }, createdAt: "2026-09-10T00:00:00Z" },
    });
    await applyCommitEvent(prisma, fakeResolveDid, ev);
    await applyCommitEvent(prisma, fakeResolveDid, ev);
    expect(await prisma.indexedLike.count({ where: { did } })).toBe(1);

    await cleanup(did);
  });

  it("a delete commit removes the IndexedLike row", async () => {
    const did = newDid();
    await applyCommitEvent(
      prisma,
      fakeResolveDid,
      commit({ did, collection: NSID.like, operation: "create", rkey: "l3", record: { subject: { uri: subjectUri } } }),
    );
    expect(await prisma.indexedLike.count({ where: { did } })).toBe(1);

    await applyCommitEvent(
      prisma,
      fakeResolveDid,
      commit({ did, collection: NSID.like, operation: "delete", rkey: "l3" }),
    );
    expect(await prisma.indexedLike.count({ where: { did } })).toBe(0);

    await cleanup(did);
  });

  it("skips a like whose record has no subject.uri (malformed against the lexicon)", async () => {
    const did = newDid();
    await applyCommitEvent(
      prisma,
      fakeResolveDid,
      commit({ did, collection: NSID.like, operation: "create", rkey: "l4", record: { subject: {} } }),
    );
    expect(await prisma.indexedLike.count({ where: { did } })).toBe(0);

    await cleanup(did);
  });
});

describe("applyCommitEvent — app.bsky.feed.like (dual-published pair)", () => {
  it("indexes only for a tracked DID AND only when the subject is a post this app hosts", async () => {
    const known = newDid();
    const unknown = newDid();
    await prisma.indexedCreatorProfile.create({ data: { did: known, handle: "known-liker.test" } });

    const creator = await prisma.user.create({ data: { did: newDid(), handle: `${randomUUID().slice(0, 8)}.test` } });
    const creatorRow = await prisma.creator.create({ data: { userId: creator.id, did: creator.did } });
    const hostedPost = await prisma.post.create({
      data: {
        creatorId: creatorRow.id,
        visibility: "PUBLIC",
        text: "hosted",
        bskyUri: `at://${creator.did}/app.bsky.feed.post/h1`,
      },
    });
    const hostedSubject = `at://${creator.did}/app.bsky.feed.post/h1`;

    // Untracked DID → dropped.
    await applyCommitEvent(
      prisma,
      fakeResolveDid,
      commit({
        did: unknown,
        collection: "app.bsky.feed.like",
        operation: "create",
        rkey: "u1",
        record: { subject: { uri: hostedSubject } },
      }),
    );
    expect(await prisma.indexedLike.count({ where: { did: unknown } })).toBe(0);

    // Tracked DID but subject isn't a hosted post → dropped.
    await applyCommitEvent(
      prisma,
      fakeResolveDid,
      commit({
        did: known,
        collection: "app.bsky.feed.like",
        operation: "create",
        rkey: "k1",
        record: { subject: { uri: "at://did:plc:someoneelse/app.bsky.feed.post/z" } },
      }),
    );
    expect(await prisma.indexedLike.count({ where: { did: known } })).toBe(0);

    // Tracked DID + hosted subject → indexed.
    await applyCommitEvent(
      prisma,
      fakeResolveDid,
      commit({
        did: known,
        collection: "app.bsky.feed.like",
        operation: "create",
        rkey: "k2",
        record: { subject: { uri: hostedSubject, cid: "bafypost" } },
      }),
    );
    const row = await prisma.indexedLike.findUniqueOrThrow({ where: { uri: `at://${known}/app.bsky.feed.like/k2` } });
    expect(row.collection).toBe("app.bsky.feed.like");
    expect(row.subjectUri).toBe(hostedSubject);

    await prisma.indexedLike.deleteMany({ where: { did: known } });
    await prisma.post.deleteMany({ where: { id: hostedPost.id } });
    await prisma.creator.deleteMany({ where: { id: creatorRow.id } });
    await prisma.user.deleteMany({ where: { id: creator.id } });
    await cleanup(known);
    await cleanup(unknown);
  });
});

describe("applyCommitEvent — app.bsky.feed.post (dual-published pair)", () => {
  it("indexes an app.bsky.feed.post only for a DID this app already tracks", async () => {
    const known = newDid();
    const unknown = newDid();
    await prisma.indexedCreatorProfile.create({ data: { did: known, handle: "known.test" } });

    await applyCommitEvent(
      prisma,
      fakeResolveDid,
      commit({ did: unknown, collection: "app.bsky.feed.post", operation: "create", rkey: "u1", record: { text: "from a stranger" } }),
    );
    expect(await prisma.indexedPost.count({ where: { did: unknown } })).toBe(0);

    await applyCommitEvent(
      prisma,
      fakeResolveDid,
      commit({
        did: known,
        collection: "app.bsky.feed.post",
        operation: "create",
        rkey: "k1",
        cid: "bafycid",
        record: { text: "dual-published", createdAt: "2026-01-01T00:00:00Z" },
      }),
    );
    const row = await prisma.indexedPost.findUniqueOrThrow({ where: { uri: `at://${known}/app.bsky.feed.post/k1` } });
    expect(row.collection).toBe("app.bsky.feed.post");
    expect(row.text).toBe("dual-published");
    expect(row.cid).toBe("bafycid");

    await cleanup(known);
    await cleanup(unknown);
  });

  it("a delete commit removes the indexed app.bsky.feed.post row", async () => {
    const did = newDid();
    await prisma.indexedCreatorProfile.create({ data: { did, handle: "d.test" } });
    await applyCommitEvent(
      prisma,
      fakeResolveDid,
      commit({ did, collection: "app.bsky.feed.post", operation: "create", rkey: "x", record: { text: "bye soon" } }),
    );
    expect(await prisma.indexedPost.count({ where: { did } })).toBe(1);

    await applyCommitEvent(
      prisma,
      fakeResolveDid,
      commit({ did, collection: "app.bsky.feed.post", operation: "delete", rkey: "x" }),
    );
    expect(await prisma.indexedPost.count({ where: { did } })).toBe(0);

    await cleanup(did);
  });

  it("records bskyUri from a fans.foryour.post record for the merge pass", async () => {
    const did = newDid();
    await applyCommitEvent(
      prisma,
      fakeResolveDid,
      commit({
        did,
        collection: NSID.post,
        operation: "create",
        rkey: "p1",
        record: { text: "linked", bskyUri: `at://${did}/app.bsky.feed.post/b1`, createdAt: "2026-01-01T00:00:00Z" },
      }),
    );
    const row = await prisma.indexedPost.findUniqueOrThrow({ where: { uri: `at://${did}/${NSID.post}/p1` } });
    expect(row.collection).toBe(NSID.post);
    expect(row.bskyUri).toBe(`at://${did}/app.bsky.feed.post/b1`);

    await cleanup(did);
  });
});
