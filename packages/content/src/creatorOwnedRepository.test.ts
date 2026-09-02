import { randomUUID } from "node:crypto";
import { getPrismaClient, type PrismaClient } from "@foryour-fans/database";
import {
  decryptText,
  encryptText,
  generateContentKey,
  unwrapContentKey,
  wrapContentKey,
} from "@foryour-fans/media";
import { NSID } from "@foryour-fans/lexicons";
import { afterAll, describe, expect, it } from "vitest";
import { AtRecordPublishError } from "@foryour-fans/atproto";
import { CreatorOwnedContentRepository } from "./creatorOwnedRepository.js";
import { FakePds } from "./fakePds.js";
import type { ContentCrypto } from "./types.js";

const prisma: PrismaClient = getPrismaClient();
const WRAP_SECRET = "content-repo-test-wrap-secret";

const crypto: ContentCrypto = {
  generateContentKey,
  encryptText,
  wrapKey: (key) => wrapContentKey(key, WRAP_SECRET),
};

function newDid(): string {
  return `did:plc:test${randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

async function makeCreator(): Promise<{ id: string; did: string }> {
  const did = newDid();
  const user = await prisma.user.create({ data: { did, handle: `${randomUUID().slice(0, 8)}.test` } });
  const creator = await prisma.creator.create({ data: { userId: user.id, did } });
  return { id: creator.id, did: creator.did };
}

async function cleanup(did: string): Promise<void> {
  await prisma.contentKeyGrant.deleteMany({ where: { contentKey: { creator: { did } } } });
  await prisma.contentKey.deleteMany({ where: { creator: { did } } });
  await prisma.post.deleteMany({ where: { creator: { did } } });
  await prisma.subscriptionTier.deleteMany({ where: { creator: { did } } });
  await prisma.creator.deleteMany({ where: { did } });
  await prisma.user.deleteMany({ where: { did } });
}

function makeRepo(pds: FakePds, opts: { gated: boolean } = { gated: false }): CreatorOwnedContentRepository {
  return new CreatorOwnedContentRepository(prisma, {
    publishAtRecord: pds.publish,
    deleteAtRecord: pds.delete,
    readAtRecord: pds.read,
    listAtRecords: pds.list,
    crypto: opts.gated ? crypto : null,
    config: { sourceApp: "foryour.fans", gatedContentEnabled: opts.gated },
  });
}

afterAll(async () => {
  await prisma.$disconnect();
});

describe("CreatorOwnedContentRepository — public posts", () => {
  it("dual-publishes app.bsky.feed.post + fans.foryour.post to the creator's PDS and demotes Postgres to a cache", async () => {
    const creator = await makeCreator();
    const pds = new FakePds();
    const repo = makeRepo(pds);

    const post = await repo.createPost({ creatorId: creator.id, visibility: "PUBLIC", text: "hello open network" });

    const collections = pds.publishCalls.map((c) => c.collection);
    expect(collections).toContain("app.bsky.feed.post");
    expect(collections).toContain(NSID.post);
    expect(pds.publishCalls.every((c) => c.did === creator.did)).toBe(true);

    const row = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
    expect(row.isAuthoritative).toBe(false);
    expect(row.sourceUri).toMatch(new RegExp(`^at://${creator.did}/${NSID.post}/`));
    expect(row.bskyUri).toMatch(new RegExp(`^at://${creator.did}/app\\.bsky\\.feed\\.post/`));

    const fansRecord = pds.all(creator.did).find((r) => r.value.$type === NSID.post)!;
    expect(fansRecord.value.visibility).toBe("public");
    expect(fansRecord.value.bskyUri).toBe(row.bskyUri);
    expect(fansRecord.value.sourceApp).toBe("foryour.fans");

    await cleanup(creator.did);
  });

  it("can be reconstructed from the creator's PDS records alone after the local cache is cleared", async () => {
    const creator = await makeCreator();
    const pds = new FakePds();
    const repo = makeRepo(pds);
    const created = await repo.createPost({ creatorId: creator.id, visibility: "PUBLIC", text: "durable on my PDS" });
    const originalBsky = (await prisma.post.findUniqueOrThrow({ where: { id: created.id } })).bskyUri;

    // Simulate a fresh app with no local content cache.
    await prisma.post.deleteMany({ where: { creatorId: creator.id } });
    expect(await prisma.post.count({ where: { creatorId: creator.id } })).toBe(0);

    const counts = await repo.rebuildFromPds(creator.did);
    expect(counts[NSID.post]).toBe(1);

    const rebuilt = await prisma.post.findFirstOrThrow({ where: { creatorId: creator.id } });
    expect(rebuilt.visibility).toBe("PUBLIC");
    expect(rebuilt.text).toBe("durable on my PDS");
    expect(rebuilt.bskyUri).toBe(originalBsky);
    expect(rebuilt.isAuthoritative).toBe(false);

    await cleanup(creator.did);
  });

  it("a different fan-service app (same PDS records, its own list call) sees the same public post", async () => {
    const creator = await makeCreator();
    const pds = new FakePds();
    await makeRepo(pds).createPost({ creatorId: creator.id, visibility: "PUBLIC", text: "portable" });

    // "Other app" = just a listRecords against the creator's DID.
    const seenByOtherApp = await pds.list("did:plc:someotherapp", { collection: NSID.post, repo: creator.did });
    expect(seenByOtherApp.records).toHaveLength(1);
    expect(seenByOtherApp.records[0]!.value.text).toBe("portable");
    expect(seenByOtherApp.records[0]!.value.canonicalUri).toBe(seenByOtherApp.records[0]!.uri);

    await cleanup(creator.did);
  });

  it("rolls back the Bluesky record and creates NO local row when the fans.foryour.post write fails", async () => {
    const creator = await makeCreator();
    const pds = new FakePds();
    pds.failPublishOn = { collection: NSID.post, nth: 1 };
    const repo = makeRepo(pds);

    await expect(
      repo.createPost({ creatorId: creator.id, visibility: "PUBLIC", text: "never lands" }),
    ).rejects.toBeInstanceOf(AtRecordPublishError);

    expect(pds.deleteCalls.map((c) => c.collection)).toContain("app.bsky.feed.post");
    expect(await prisma.post.count({ where: { creatorId: creator.id } })).toBe(0);

    await cleanup(creator.did);
  });

  it("writes a lexicon-shaped app.bsky.feed.post with parsed link facets + mirrored langs/tags", async () => {
    const creator = await makeCreator();
    const pds = new FakePds();
    const repo = new CreatorOwnedContentRepository(prisma, {
      publishAtRecord: pds.publish,
      deleteAtRecord: pds.delete,
      readAtRecord: pds.read,
      listAtRecords: pds.list,
      crypto: null,
      resolveHandleToDid: async (h) => (h === "alice.test" ? "did:plc:alice" : null),
      config: { sourceApp: "foryour.fans", gatedContentEnabled: false },
    });

    await repo.createPost({
      creatorId: creator.id,
      visibility: "PUBLIC",
      text: "read more at example.com hi @alice.test",
      langs: ["en"],
      tags: ["news"],
    });

    const bsky = pds.all(creator.did).find((r) => r.value.$type === "app.bsky.feed.post")!;
    expect(bsky.value.text).toBe("read more at example.com hi @alice.test");
    expect(bsky.value.langs).toEqual(["en"]);
    expect(bsky.value.tags).toEqual(["news"]);
    const facets = bsky.value.facets as Array<{ features: Array<{ $type: string }> }>;
    const kinds = facets.flatMap((f) => f.features.map((x) => x.$type));
    expect(kinds).toContain("app.bsky.richtext.facet#link");
    expect(kinds).toContain("app.bsky.richtext.facet#mention");
    // The custom record mirrors langs/tags too.
    const fans = pds.all(creator.did).find((r) => r.value.$type === NSID.post)!;
    expect(fans.value.langs).toEqual(["en"]);
    expect(fans.value.tags).toEqual(["news"]);

    await cleanup(creator.did);
  });

  it("a failed app.bsky.feed.post write creates NO custom record and NO local row", async () => {
    const creator = await makeCreator();
    const pds = new FakePds();
    pds.failPublishOn = { collection: "app.bsky.feed.post", nth: 1 };
    const repo = makeRepo(pds);

    await expect(
      repo.createPost({ creatorId: creator.id, visibility: "PUBLIC", text: "half a pair" }),
    ).rejects.toBeInstanceOf(AtRecordPublishError);

    expect(pds.publishCalls.map((c) => c.collection)).not.toContain(NSID.post);
    expect(pds.all(creator.did)).toHaveLength(0);
    expect(await prisma.post.count({ where: { creatorId: creator.id } })).toBe(0);

    await cleanup(creator.did);
  });

  it("PUBLIC -> PUBLIC edit reuses BOTH rkeys and republishes in place", async () => {
    const creator = await makeCreator();
    const pds = new FakePds();
    const repo = makeRepo(pds);
    const post = await repo.createPost({ creatorId: creator.id, visibility: "PUBLIC", text: "v1" });
    const before = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });

    await repo.updatePost(post.id, creator.id, { text: "v2 edited" });

    const after = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
    expect(after.atRkey).toBe(before.atRkey);
    expect(after.bskyRkey).toBe(before.bskyRkey);
    expect(after.bskyUri).toBe(before.bskyUri);
    expect(pds.deleteCalls).toHaveLength(0); // no retract
    const bsky = pds.all(creator.did).find((r) => r.value.$type === "app.bsky.feed.post")!;
    expect(bsky.value.text).toBe("v2 edited");

    await cleanup(creator.did);
  });

  it("PUBLIC -> SUBSCRIBERS retracts the app.bsky.feed.post and clears the linkage", async () => {
    const creator = await makeCreator();
    const pds = new FakePds();
    const repo = makeRepo(pds, { gated: false });
    const post = await repo.createPost({ creatorId: creator.id, visibility: "PUBLIC", text: "was public" });

    await repo.updatePost(post.id, creator.id, { visibility: "SUBSCRIBERS", text: "now gated" });

    expect(pds.deleteCalls.map((c) => c.collection)).toContain("app.bsky.feed.post");
    expect(pds.all(creator.did).some((r) => r.value.$type === "app.bsky.feed.post")).toBe(false);
    const row = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
    expect(row.bskyUri).toBeNull();
    expect(row.bskyRkey).toBeNull();
    expect(row.visibility).toBe("SUBSCRIBERS");
    expect(row.isAuthoritative).toBe(true); // gated flag off → Postgres-only

    await cleanup(creator.did);
  });

  it("deleting a public post retracts both PDS records and soft-deletes the cache row", async () => {
    const creator = await makeCreator();
    const pds = new FakePds();
    const repo = makeRepo(pds);
    const post = await repo.createPost({ creatorId: creator.id, visibility: "PUBLIC", text: "goodbye" });

    await repo.deletePost(post.id, creator.id);

    expect(pds.deleteCalls.map((c) => c.collection).sort()).toEqual([NSID.post, "app.bsky.feed.post"].sort());
    expect(pds.all(creator.did)).toHaveLength(0);
    const row = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
    expect(row.deletedAt).not.toBeNull();

    await cleanup(creator.did);
  });
});

describe("CreatorOwnedContentRepository — gated posts (flag ON)", () => {
  it("encrypts the body before it reaches the PDS, keeps no local plaintext, and wraps the content key at rest", async () => {
    const creator = await makeCreator();
    const pds = new FakePds();
    const repo = makeRepo(pds, { gated: true });

    const post = await repo.createPost({
      creatorId: creator.id,
      visibility: "SUBSCRIBERS",
      text: "subscriber-only body",
    });

    // Nothing published as a normal public Bluesky post.
    expect(pds.publishCalls.map((c) => c.collection)).not.toContain("app.bsky.feed.post");
    const published = pds.all(creator.did);
    expect(published.map((r) => r.value.$type).sort()).toEqual([NSID.accessPolicy, NSID.post].sort());

    const postRecord = published.find((r) => r.value.$type === NSID.post)!;
    expect(postRecord.value.text).toBe("");
    const enc = postRecord.value.encryptedBody as { ciphertext: string; algorithm: string };
    expect(enc.algorithm).toBe("AES-256-GCM");
    // The plaintext appears nowhere in the record.
    expect(JSON.stringify(postRecord.value)).not.toContain("subscriber-only body");

    const row = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
    expect(row.isAuthoritative).toBe(false);
    expect(row.text).toBe("");

    const contentKey = await prisma.contentKey.findUniqueOrThrow({ where: { subjectUri: row.sourceUri! } });
    expect(contentKey.wrappedKey).not.toContain("subscriber-only body");
    // The content key is recoverable only with the wrap secret.
    const key = unwrapContentKey(contentKey.wrappedKey, WRAP_SECRET);
    expect(decryptText(enc as never, key)).toBe("subscriber-only body");

    await cleanup(creator.did);
  });

  it("a TIER post's access policy references the tier by AT URI, never a local DB id or price", async () => {
    const creator = await makeCreator();
    const tier = await prisma.subscriptionTier.create({
      data: {
        creatorId: creator.id,
        name: "VIP",
        priceCents: 2500,
        currency: "usd",
        atRkey: "tier-rkey-1",
        sourceUri: `at://${creator.did}/${NSID.tier}/tier-rkey-1`,
      },
    });
    const pds = new FakePds();
    const repo = makeRepo(pds, { gated: true });

    await repo.createPost({
      creatorId: creator.id,
      visibility: "TIER",
      minimumTierId: tier.id,
      text: "top tier only",
    });

    const policy = pds.all(creator.did).find((r) => r.value.$type === NSID.accessPolicy)!;
    expect(policy.value.audience).toBe("tier");
    expect((policy.value.minimumTier as { uri: string }).uri).toBe(tier.sourceUri);
    const asJson = JSON.stringify(pds.all(creator.did));
    expect(asJson).not.toContain(tier.id); // no local uuid
    expect(asJson).not.toContain("2500"); // no price
    expect(asJson).not.toMatch(/priceCents|stripe|customer|subscriber/i);

    await cleanup(creator.did);
  });
});

describe("CreatorOwnedContentRepository — gated posts (flag OFF = stop-and-defer)", () => {
  it("keeps a gated post Postgres-only and app-authoritative, never touching the PDS", async () => {
    const creator = await makeCreator();
    const pds = new FakePds();
    const repo = makeRepo(pds, { gated: false });

    const post = await repo.createPost({
      creatorId: creator.id,
      visibility: "SUBSCRIBERS",
      text: "deferred paid content",
    });

    expect(pds.publishCalls).toHaveLength(0);
    const row = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
    expect(row.isAuthoritative).toBe(true);
    expect(row.sourceUri).toBeNull();
    expect(row.text).toBe("deferred paid content");
    expect(await prisma.contentKey.count({ where: { creatorId: creator.id } })).toBe(0);

    await cleanup(creator.did);
  });
});
