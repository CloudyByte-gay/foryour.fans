import { randomUUID } from "node:crypto";
import { getPrismaClient, type PrismaClient } from "@foryour-fans/database";
import { afterAll, describe, expect, it } from "vitest";
import { PostNotFoundError, PrivateContentRepository } from "./repository.js";

/**
 * Exercises PrivateContentRepository directly against real Postgres, with
 * fake AT publish/delete functions — the same pattern apps/api/test uses,
 * duplicated in miniature here rather than imported (a package can't depend
 * on an app's test helpers; see docs/architecture.md's package-boundary
 * note). This is the ONLY place updatePost's visibility-transition
 * publish/retract logic is exercised — Phase 7 defines no HTTP route for
 * it (only createPost/deletePost/getPost/getCreatorFeed have routes; see
 * apps/api/src/routes/posts.ts), but the interface requires it and its AT
 * transition logic is exactly the kind of thing worth a real test.
 */

const prisma: PrismaClient = getPrismaClient();

function newDid(): string {
  return `did:plc:test${randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

interface RecordedPublish {
  did: string;
  collection: string;
  rkey: string;
  record: Record<string, unknown>;
}
interface RecordedDelete {
  did: string;
  collection: string;
  rkey: string;
}

function fakePublish(): { calls: RecordedPublish[]; publish: (did: string, params: Omit<RecordedPublish, "did">) => Promise<{ uri: string; cid: string }> } {
  const calls: RecordedPublish[] = [];
  return {
    calls,
    publish: async (did, params) => {
      calls.push({ did, ...params });
      return { uri: `at://${did}/${params.collection}/${params.rkey}`, cid: "bafyfakecid" };
    },
  };
}

function fakeDelete(): { calls: RecordedDelete[]; del: (did: string, params: Omit<RecordedDelete, "did">) => Promise<void> } {
  const calls: RecordedDelete[] = [];
  return {
    calls,
    del: async (did, params) => {
      calls.push({ did, ...params });
    },
  };
}

async function makeCreator(): Promise<{ id: string; did: string }> {
  const did = newDid();
  const user = await prisma.user.create({ data: { did, handle: `${randomUUID().slice(0, 8)}.test` } });
  const creator = await prisma.creator.create({ data: { userId: user.id, did } });
  return { id: creator.id, did: creator.did };
}

async function cleanup(did: string): Promise<void> {
  // FK order: posts reference subscription_tiers (SET NULL, so posts could
  // go first or last safely), but subscription_tiers -> creators is a plain
  // FK with no cascade, so tiers must go before the creator row does.
  await prisma.postMedia.deleteMany({ where: { post: { creator: { did } } } });
  await prisma.post.deleteMany({ where: { creator: { did } } });
  await prisma.mediaAsset.deleteMany({ where: { creator: { did } } });
  await prisma.subscriptionTier.deleteMany({ where: { creator: { did } } });
  await prisma.creator.deleteMany({ where: { did } });
  await prisma.user.deleteMany({ where: { did } });
}

async function makeReadyAsset(creatorId: string): Promise<string> {
  const asset = await prisma.mediaAsset.create({
    data: {
      creatorId,
      storageKey: `media/${creatorId}/${randomUUID()}.png`,
      mimeType: "image/png",
      size: 1024,
      status: "READY",
    },
  });
  return asset.id;
}

afterAll(async () => {
  await prisma.$disconnect();
});

describe("PrivateContentRepository", () => {
  it("createPost with PUBLIC visibility publishes a fans.foryour.post AT record", async () => {
    const creator = await makeCreator();
    const publish = fakePublish();
    const del = fakeDelete();
    const repo = new PrivateContentRepository(prisma, publish.publish, del.del);

    const post = await repo.createPost({ creatorId: creator.id, visibility: "PUBLIC", text: "hello world" });

    expect(publish.calls).toHaveLength(1);
    expect(publish.calls[0]?.did).toBe(creator.did);
    expect(publish.calls[0]?.record.text).toBe("hello world");
    expect(post.visibility).toBe("PUBLIC");

    await cleanup(creator.did);
  });

  it("createPost with SUBSCRIBERS visibility never touches the AT network", async () => {
    const creator = await makeCreator();
    const publish = fakePublish();
    const del = fakeDelete();
    const repo = new PrivateContentRepository(prisma, publish.publish, del.del);

    const post = await repo.createPost({ creatorId: creator.id, visibility: "SUBSCRIBERS", text: "paid content" });

    expect(publish.calls).toHaveLength(0);
    expect(post.visibility).toBe("SUBSCRIBERS");

    await cleanup(creator.did);
  });

  it("createPost with TIER visibility stores minimumTierId and never touches the AT network", async () => {
    const creator = await makeCreator();
    const tier = await prisma.subscriptionTier.create({
      data: { creatorId: creator.id, name: "VIP", priceCents: 1000, currency: "usd", atRkey: randomUUID() },
    });
    const publish = fakePublish();
    const del = fakeDelete();
    const repo = new PrivateContentRepository(prisma, publish.publish, del.del);

    const post = await repo.createPost({ creatorId: creator.id, visibility: "TIER", minimumTierId: tier.id, text: "premium" });

    expect(publish.calls).toHaveLength(0);
    expect(post.minimumTierId).toBe(tier.id);

    await cleanup(creator.did);
  });

  it("updatePost: PUBLIC -> SUBSCRIBERS retracts the AT record", async () => {
    const creator = await makeCreator();
    const publish = fakePublish();
    const del = fakeDelete();
    const repo = new PrivateContentRepository(prisma, publish.publish, del.del);
    const post = await repo.createPost({ creatorId: creator.id, visibility: "PUBLIC", text: "will go private" });

    const updated = await repo.updatePost(post.id, creator.id, { visibility: "SUBSCRIBERS" });

    expect(del.calls).toHaveLength(1);
    expect(del.calls[0]?.did).toBe(creator.did);
    expect(updated.visibility).toBe("SUBSCRIBERS");

    await cleanup(creator.did);
  });

  it("updatePost: SUBSCRIBERS -> PUBLIC publishes a new AT record", async () => {
    const creator = await makeCreator();
    const publish = fakePublish();
    const del = fakeDelete();
    const repo = new PrivateContentRepository(prisma, publish.publish, del.del);
    const post = await repo.createPost({ creatorId: creator.id, visibility: "SUBSCRIBERS", text: "will go public" });
    expect(publish.calls).toHaveLength(0);

    const updated = await repo.updatePost(post.id, creator.id, { visibility: "PUBLIC" });

    expect(publish.calls).toHaveLength(1);
    expect(updated.visibility).toBe("PUBLIC");

    await cleanup(creator.did);
  });

  it("updatePost: staying PUBLIC republishes under the SAME rkey", async () => {
    const creator = await makeCreator();
    const publish = fakePublish();
    const del = fakeDelete();
    const repo = new PrivateContentRepository(prisma, publish.publish, del.del);
    const post = await repo.createPost({ creatorId: creator.id, visibility: "PUBLIC", text: "v1" });
    const firstRkey = publish.calls[0]?.rkey;

    await repo.updatePost(post.id, creator.id, { text: "v2" });

    expect(publish.calls).toHaveLength(2);
    expect(publish.calls[1]?.rkey).toBe(firstRkey);
    expect(publish.calls[1]?.record.text).toBe("v2");

    await cleanup(creator.did);
  });

  it("updatePost: staying SUBSCRIBERS never touches the AT network", async () => {
    const creator = await makeCreator();
    const publish = fakePublish();
    const del = fakeDelete();
    const repo = new PrivateContentRepository(prisma, publish.publish, del.del);
    const post = await repo.createPost({ creatorId: creator.id, visibility: "SUBSCRIBERS", text: "v1" });

    await repo.updatePost(post.id, creator.id, { text: "v2" });

    expect(publish.calls).toHaveLength(0);
    expect(del.calls).toHaveLength(0);

    await cleanup(creator.did);
  });

  it("updatePost throws PostNotFoundError for a post owned by a different creator", async () => {
    const owner = await makeCreator();
    const stranger = await makeCreator();
    const publish = fakePublish();
    const del = fakeDelete();
    const repo = new PrivateContentRepository(prisma, publish.publish, del.del);
    const post = await repo.createPost({ creatorId: owner.id, visibility: "SUBSCRIBERS", text: "mine" });

    await expect(repo.updatePost(post.id, stranger.id, { text: "hijacked" })).rejects.toThrow(PostNotFoundError);

    await cleanup(owner.did);
    await cleanup(stranger.did);
  });

  it("deletePost soft-deletes and retracts the AT record when the post was PUBLIC", async () => {
    const creator = await makeCreator();
    const publish = fakePublish();
    const del = fakeDelete();
    const repo = new PrivateContentRepository(prisma, publish.publish, del.del);
    const post = await repo.createPost({ creatorId: creator.id, visibility: "PUBLIC", text: "goodbye" });

    await repo.deletePost(post.id, creator.id);

    expect(del.calls).toHaveLength(1);
    const row = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
    expect(row.deletedAt).not.toBeNull();

    await cleanup(creator.did);
  });

  it("deletePost soft-deletes without any AT interaction when the post was never PUBLIC", async () => {
    const creator = await makeCreator();
    const publish = fakePublish();
    const del = fakeDelete();
    const repo = new PrivateContentRepository(prisma, publish.publish, del.del);
    const post = await repo.createPost({ creatorId: creator.id, visibility: "SUBSCRIBERS", text: "goodbye" });

    await repo.deletePost(post.id, creator.id);

    expect(del.calls).toHaveLength(0);

    await cleanup(creator.did);
  });

  it("deletePost throws PostNotFoundError for a post owned by a different creator", async () => {
    const owner = await makeCreator();
    const stranger = await makeCreator();
    const publish = fakePublish();
    const del = fakeDelete();
    const repo = new PrivateContentRepository(prisma, publish.publish, del.del);
    const post = await repo.createPost({ creatorId: owner.id, visibility: "SUBSCRIBERS", text: "mine" });

    await expect(repo.deletePost(post.id, stranger.id)).rejects.toThrow(PostNotFoundError);

    await cleanup(owner.did);
    await cleanup(stranger.did);
  });

  it("getPost returns null for a soft-deleted post", async () => {
    const creator = await makeCreator();
    const publish = fakePublish();
    const del = fakeDelete();
    const repo = new PrivateContentRepository(prisma, publish.publish, del.del);
    const post = await repo.createPost({ creatorId: creator.id, visibility: "SUBSCRIBERS", text: "temp" });
    await repo.deletePost(post.id, creator.id);

    const result = await repo.getPost(post.id);
    expect(result).toBeNull();

    await cleanup(creator.did);
  });

  it("getPost returns null for a nonexistent post", async () => {
    const repo = new PrivateContentRepository(prisma, fakePublish().publish, fakeDelete().del);
    const result = await repo.getPost("00000000-0000-0000-0000-000000000000");
    expect(result).toBeNull();
  });

  it("getCreatorFeed excludes soft-deleted posts", async () => {
    const creator = await makeCreator();
    const publish = fakePublish();
    const del = fakeDelete();
    const repo = new PrivateContentRepository(prisma, publish.publish, del.del);
    const first = await repo.createPost({ creatorId: creator.id, visibility: "SUBSCRIBERS", text: "first" });
    const second = await repo.createPost({ creatorId: creator.id, visibility: "SUBSCRIBERS", text: "second" });
    const third = await repo.createPost({ creatorId: creator.id, visibility: "SUBSCRIBERS", text: "third" });
    await repo.deletePost(second.id, creator.id);

    const feed = await repo.getCreatorFeed(creator.id);

    expect(feed.map((p) => p.id).sort()).toEqual([first.id, third.id].sort());

    await cleanup(creator.did);
  });

  it("getCreatorFeed orders newest-first", async () => {
    const creator = await makeCreator();
    const publish = fakePublish();
    const del = fakeDelete();
    const repo = new PrivateContentRepository(prisma, publish.publish, del.del);
    const older = await repo.createPost({ creatorId: creator.id, visibility: "SUBSCRIBERS", text: "older" });
    const newer = await repo.createPost({ creatorId: creator.id, visibility: "SUBSCRIBERS", text: "newer" });
    // Real inserts can land in the same millisecond, making createdAt-order
    // ambiguous by wall-clock alone — force unambiguous, distinct
    // timestamps rather than relying on real elapsed time between creates.
    await prisma.post.update({ where: { id: older.id }, data: { createdAt: new Date(Date.now() - 60_000) } });
    await prisma.post.update({ where: { id: newer.id }, data: { createdAt: new Date(Date.now() - 30_000) } });

    const feed = await repo.getCreatorFeed(creator.id);

    expect(feed.map((p) => p.id)).toEqual([newer.id, older.id]);

    await cleanup(creator.did);
  });

  it("getCreatorFeed cursor pagination returns every post exactly once, in order, across pages", async () => {
    const creator = await makeCreator();
    const publish = fakePublish();
    const del = fakeDelete();
    const repo = new PrivateContentRepository(prisma, publish.publish, del.del);
    const posts = [];
    for (let i = 0; i < 5; i++) {
      posts.push(await repo.createPost({ creatorId: creator.id, visibility: "SUBSCRIBERS", text: `post ${i}` }));
    }
    // Force distinct timestamps — see the "orders newest-first" test above for why.
    for (const [i, post] of posts.entries()) {
      await prisma.post.update({ where: { id: post.id }, data: { createdAt: new Date(Date.now() - (5 - i) * 60_000) } });
    }
    const expectedOrder = [...posts].reverse().map((p) => p.id); // newest (last created) first

    const page1 = await repo.getCreatorFeed(creator.id, { limit: 2 });
    expect(page1.map((p) => p.id)).toEqual(expectedOrder.slice(0, 2));

    const page2 = await repo.getCreatorFeed(creator.id, { limit: 2, cursor: page1[1]!.id });
    expect(page2.map((p) => p.id)).toEqual(expectedOrder.slice(2, 4));

    const page3 = await repo.getCreatorFeed(creator.id, { limit: 2, cursor: page2[1]!.id });
    expect(page3.map((p) => p.id)).toEqual(expectedOrder.slice(4, 5));

    await cleanup(creator.did);
  });
});

describe("PrivateContentRepository.getFeed", () => {
  it("includes PUBLIC posts from any creator, with no unlockedCreatorIds needed", async () => {
    const creator = await makeCreator();
    const publish = fakePublish();
    const del = fakeDelete();
    const repo = new PrivateContentRepository(prisma, publish.publish, del.del);
    const post = await repo.createPost({ creatorId: creator.id, visibility: "PUBLIC", text: "public post" });

    const feed = await repo.getFeed();

    expect(feed.map((p) => p.id)).toContain(post.id);

    await cleanup(creator.did);
  });

  it("excludes SUBSCRIBERS/TIER posts from a creator NOT in unlockedCreatorIds", async () => {
    const creator = await makeCreator();
    const publish = fakePublish();
    const del = fakeDelete();
    const repo = new PrivateContentRepository(prisma, publish.publish, del.del);
    const post = await repo.createPost({ creatorId: creator.id, visibility: "SUBSCRIBERS", text: "gated" });

    const feed = await repo.getFeed();

    expect(feed.map((p) => p.id)).not.toContain(post.id);

    await cleanup(creator.did);
  });

  it("includes SUBSCRIBERS/TIER posts from a creator IN unlockedCreatorIds", async () => {
    const creator = await makeCreator();
    const publish = fakePublish();
    const del = fakeDelete();
    const repo = new PrivateContentRepository(prisma, publish.publish, del.del);
    const post = await repo.createPost({ creatorId: creator.id, visibility: "SUBSCRIBERS", text: "gated" });

    const feed = await repo.getFeed({ unlockedCreatorIds: [creator.id] });

    expect(feed.map((p) => p.id)).toContain(post.id);

    await cleanup(creator.did);
  });

  it("excludes posts from a SUSPENDED creator, even a PUBLIC one", async () => {
    const creator = await makeCreator();
    const publish = fakePublish();
    const del = fakeDelete();
    const repo = new PrivateContentRepository(prisma, publish.publish, del.del);
    const post = await repo.createPost({ creatorId: creator.id, visibility: "PUBLIC", text: "public post" });
    await prisma.creator.update({ where: { id: creator.id }, data: { status: "SUSPENDED" } });

    const feed = await repo.getFeed();

    expect(feed.map((p) => p.id)).not.toContain(post.id);

    await cleanup(creator.did);
  });

  it("excludes soft-deleted posts", async () => {
    const creator = await makeCreator();
    const publish = fakePublish();
    const del = fakeDelete();
    const repo = new PrivateContentRepository(prisma, publish.publish, del.del);
    const post = await repo.createPost({ creatorId: creator.id, visibility: "PUBLIC", text: "public post" });
    await repo.deletePost(post.id, creator.id);

    const feed = await repo.getFeed();

    expect(feed.map((p) => p.id)).not.toContain(post.id);

    await cleanup(creator.did);
  });

  describe("media attachments (WEB PHASE 8)", () => {
    it("persists attachments on create and resolves them, sorted, on every read", async () => {
      const creator = await makeCreator();
      const repo = new PrivateContentRepository(prisma, fakePublish().publish, fakeDelete().del);
      const a = await makeReadyAsset(creator.id);
      const b = await makeReadyAsset(creator.id);

      const created = await repo.createPost({
        creatorId: creator.id,
        visibility: "SUBSCRIBERS",
        text: "two files",
        media: [
          { mediaAssetId: b, sortOrder: 9 },
          { mediaAssetId: a, sortOrder: 1 },
        ],
      });
      expect(created.media.map((m) => ({ mediaAssetId: m.mediaAssetId, sortOrder: m.sortOrder }))).toEqual([
        { mediaAssetId: a, sortOrder: 0 },
        { mediaAssetId: b, sortOrder: 1 },
      ]);
      expect(created.media[0]?.mimeType).toBe("image/png");

      const fetched = await repo.getPost(created.id);
      expect(fetched?.media).toEqual(created.media);
      const feed = await repo.getCreatorFeed(creator.id);
      expect(feed[0]?.media).toEqual(created.media);

      await cleanup(creator.did);
    });

    it("updatePost replaces attachments when given `media`, and leaves them when it is omitted", async () => {
      const creator = await makeCreator();
      const repo = new PrivateContentRepository(prisma, fakePublish().publish, fakeDelete().del);
      const a = await makeReadyAsset(creator.id);
      const b = await makeReadyAsset(creator.id);
      const created = await repo.createPost({
        creatorId: creator.id,
        visibility: "SUBSCRIBERS",
        text: "v1",
        media: [{ mediaAssetId: a, sortOrder: 0 }],
      });

      const untouched = await repo.updatePost(created.id, creator.id, { text: "v2" });
      expect(untouched.media.map((m) => m.mediaAssetId)).toEqual([a]);

      const replaced = await repo.updatePost(created.id, creator.id, { media: [{ mediaAssetId: b, sortOrder: 0 }] });
      expect(replaced.media.map((m) => m.mediaAssetId)).toEqual([b]);

      const cleared = await repo.updatePost(created.id, creator.id, { media: [] });
      expect(cleared.media).toEqual([]);
      expect(await prisma.postMedia.count({ where: { postId: created.id } })).toBe(0);

      await cleanup(creator.did);
    });

    it("rejects an asset owned by another creator, before any AT write", async () => {
      const creator = await makeCreator();
      const other = await makeCreator();
      const publish = fakePublish();
      const repo = new PrivateContentRepository(prisma, publish.publish, fakeDelete().del);
      const foreign = await makeReadyAsset(other.id);

      await expect(
        repo.createPost({
          creatorId: creator.id,
          visibility: "PUBLIC",
          text: "borrowed",
          media: [{ mediaAssetId: foreign, sortOrder: 0 }],
        }),
      ).rejects.toThrow(/does not belong to you/i);
      expect(publish.calls).toHaveLength(0);

      await cleanup(creator.did);
      await cleanup(other.did);
    });
  });
});
