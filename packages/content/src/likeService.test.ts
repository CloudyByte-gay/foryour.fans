import { randomUUID } from "node:crypto";
import { getPrismaClient, type PrismaClient } from "@foryour-fans/database";
import { BSKY_NSID, NSID } from "@foryour-fans/lexicons";
import { AtRecordDeleteError, AtRecordPublishError, type DeleteAtRecord } from "@foryour-fans/atproto";
import { afterAll, describe, expect, it } from "vitest";
import { FakePds } from "./fakePds.js";
import { LikeService } from "./likeService.js";
import type { PostRecord } from "./types.js";

const prisma: PrismaClient = getPrismaClient();

function newDid(): string {
  return `did:plc:test${randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

async function makeUser(): Promise<{ id: string; did: string }> {
  const did = newDid();
  const user = await prisma.user.create({ data: { did, handle: `${randomUUID().slice(0, 8)}.test` } });
  return { id: user.id, did };
}

async function makeCreator(): Promise<{ id: string; did: string; userId: string }> {
  const u = await makeUser();
  const creator = await prisma.creator.create({ data: { userId: u.id, did: u.did } });
  return { id: creator.id, did: u.did, userId: u.id };
}

async function makePostRow(creatorId: string, visibility: "PUBLIC" | "SUBSCRIBERS" | "TIER"): Promise<string> {
  const row = await prisma.post.create({ data: { creatorId, visibility, text: "a post" } });
  return row.id;
}

function postRecord(id: string, overrides: Partial<PostRecord> = {}): PostRecord {
  return {
    id,
    creatorId: "creator-id",
    visibility: "PUBLIC",
    minimumTierId: null,
    text: "a post",
    media: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    foryourAtUri: null,
    foryourAtCid: null,
    bskyAtUri: null,
    bskyAtCid: null,
    canonicalUri: null,
    sourceCollections: [],
    containsAdultContent: false,
    ...overrides,
  };
}

const CREATOR_DID = "did:plc:testcreatorxxxxxxxxxx";
function publicPdsPost(id: string, rkey = "3kpost"): PostRecord {
  const foryourAtUri = `at://${CREATOR_DID}/${NSID.post}/${rkey}`;
  const bskyAtUri = `at://${CREATOR_DID}/${BSKY_NSID.feedPost}/${rkey}`;
  return postRecord(id, {
    foryourAtUri,
    foryourAtCid: "bafyforyourcid",
    bskyAtUri,
    bskyAtCid: "bafybskycid",
    canonicalUri: foryourAtUri,
    sourceCollections: [NSID.post, BSKY_NSID.feedPost],
  });
}

function makeService(pds: FakePds, atEnabled: boolean, deleteOverride?: DeleteAtRecord): LikeService {
  return new LikeService(prisma, {
    publishAtRecord: pds.publish,
    deleteAtRecord: deleteOverride ?? pds.delete,
    readAtRecord: pds.read,
    atEnabled,
  });
}

async function cleanup(dids: string[]): Promise<void> {
  await prisma.like.deleteMany({ where: { user: { did: { in: dids } } } });
  await prisma.like.deleteMany({ where: { post: { creator: { did: { in: dids } } } } });
  await prisma.indexedLike.deleteMany({ where: { did: { in: dids } } });
  await prisma.post.deleteMany({ where: { creator: { did: { in: dids } } } });
  await prisma.creator.deleteMany({ where: { did: { in: dids } } });
  await prisma.user.deleteMany({ where: { did: { in: dids } } });
}

afterAll(async () => {
  await prisma.$disconnect();
});

describe("LikeService — flag OFF (Postgres-only, Phase 12 behavior)", () => {
  it("like/unlike touch only the likes table and write no AT records", async () => {
    const creator = await makeCreator();
    const liker = await makeUser();
    const postId = await makePostRow(creator.id, "PUBLIC");
    const pds = new FakePds();
    const svc = makeService(pds, false);

    const liked = await svc.like(publicPdsPost(postId), { userId: liker.id, did: liker.did });
    expect(liked).toEqual({ likeCount: 1, likedByViewer: true });
    expect(pds.publishCalls).toHaveLength(0);

    const row = await prisma.like.findFirstOrThrow({ where: { postId, userId: liker.id } });
    expect(row.isAuthoritative).toBe(true);
    expect(row.sourceUri).toBeNull();

    const unliked = await svc.unlike(publicPdsPost(postId), { userId: liker.id, did: liker.did });
    expect(unliked).toEqual({ likeCount: 0, likedByViewer: false });
    expect(pds.deleteCalls).toHaveLength(0);

    await cleanup([creator.did, liker.did]);
  });
});

describe("LikeService — flag ON", () => {
  it("dual-publishes fans.foryour.like + app.bsky.feed.like to the LIKER's repo for a PUBLIC post", async () => {
    const creator = await makeCreator();
    const liker = await makeUser();
    const postId = await makePostRow(creator.id, "PUBLIC");
    const pds = new FakePds();
    const svc = makeService(pds, true);

    const state = await svc.like(publicPdsPost(postId), { userId: liker.id, did: liker.did });
    expect(state).toEqual({ likeCount: 1, likedByViewer: true });

    const collections = pds.publishCalls.map((c) => c.collection).sort();
    expect(collections).toEqual([BSKY_NSID.feedLike, NSID.like].sort());
    expect(pds.publishCalls.every((c) => c.did === liker.did)).toBe(true);
    const fansLike = pds.publishCalls.find((c) => c.collection === NSID.like)!;
    expect(fansLike.record.subject).toMatchObject({ uri: `at://${CREATOR_DID}/${NSID.post}/3kpost`, cid: "bafyforyourcid" });

    const row = await prisma.like.findFirstOrThrow({ where: { postId, userId: liker.id } });
    expect(row.isAuthoritative).toBe(false);
    expect(row.sourceUri).toMatch(new RegExp(`^at://${liker.did}/${NSID.like}/`));
    expect(row.bskyUri).toMatch(new RegExp(`^at://${liker.did}/app\\.bsky\\.feed\\.like/`));

    await cleanup([creator.did, liker.did]);
  });

  it("resolves the subject CID via readAtRecord when the PostRecord has none", async () => {
    const creator = await makeCreator();
    const liker = await makeUser();
    const postId = await makePostRow(creator.id, "PUBLIC");
    const pds = new FakePds();
    // Seed the post record in the fake PDS so read() can supply a CID.
    const seeded = await pds.publish(CREATOR_DID, { collection: NSID.post, rkey: "3kpost", record: { $type: NSID.post } });
    pds.publishCalls.length = 0;
    const svc = makeService(pds, true);

    await svc.like(
      postRecord(postId, {
        foryourAtUri: `at://${CREATOR_DID}/${NSID.post}/3kpost`,
        foryourAtCid: null,
        canonicalUri: `at://${CREATOR_DID}/${NSID.post}/3kpost`,
        sourceCollections: [NSID.post],
      }),
      { userId: liker.id, did: liker.did },
    );

    const fansLike = pds.publishCalls.find((c) => c.collection === NSID.like)!;
    expect((fansLike.record.subject as { cid: string }).cid).toBe(seeded.cid);
    // No bsky like — this post was mirror-only (no bskyAtUri).
    expect(pds.publishCalls.some((c) => c.collection === BSKY_NSID.feedLike)).toBe(false);

    await cleanup([creator.did, liker.did]);
  });

  it("keeps a like on a gated (SUBSCRIBERS) post Postgres-only — the deferred protocol gap", async () => {
    const creator = await makeCreator();
    const liker = await makeUser();
    const postId = await makePostRow(creator.id, "SUBSCRIBERS");
    const pds = new FakePds();
    const svc = makeService(pds, true);

    await svc.like(postRecord(postId, { visibility: "SUBSCRIBERS" }), { userId: liker.id, did: liker.did });

    expect(pds.publishCalls).toHaveLength(0);
    const row = await prisma.like.findFirstOrThrow({ where: { postId, userId: liker.id } });
    expect(row.isAuthoritative).toBe(true);

    await cleanup([creator.did, liker.did]);
  });

  it("is idempotent — a second like writes no new AT record", async () => {
    const creator = await makeCreator();
    const liker = await makeUser();
    const postId = await makePostRow(creator.id, "PUBLIC");
    const pds = new FakePds();
    const svc = makeService(pds, true);
    const post = publicPdsPost(postId);

    await svc.like(post, { userId: liker.id, did: liker.did });
    const publishesAfterFirst = pds.publishCalls.length;
    const state = await svc.like(post, { userId: liker.id, did: liker.did });

    expect(state).toEqual({ likeCount: 1, likedByViewer: true });
    expect(pds.publishCalls).toHaveLength(publishesAfterFirst);
    expect(await prisma.like.count({ where: { postId, userId: liker.id } })).toBe(1);

    await cleanup([creator.did, liker.did]);
  });

  it("rolls back the fans.foryour.like and creates NO row when the app.bsky.feed.like write fails", async () => {
    const creator = await makeCreator();
    const liker = await makeUser();
    const postId = await makePostRow(creator.id, "PUBLIC");
    const pds = new FakePds();
    pds.failPublishOn = { collection: BSKY_NSID.feedLike, nth: 1 };
    const svc = makeService(pds, true);

    await expect(svc.like(publicPdsPost(postId), { userId: liker.id, did: liker.did })).rejects.toBeInstanceOf(
      AtRecordPublishError,
    );

    expect(pds.deleteCalls.map((c) => c.collection)).toContain(NSID.like);
    expect(await prisma.like.count({ where: { postId, userId: liker.id } })).toBe(0);

    await cleanup([creator.did, liker.did]);
  });

  it("unlike tolerates an already-deleted AT record and still removes the local row", async () => {
    const creator = await makeCreator();
    const liker = await makeUser();
    const postId = await makePostRow(creator.id, "PUBLIC");
    const pds = new FakePds();
    const svc = makeService(pds, true);
    const post = publicPdsPost(postId);
    await svc.like(post, { userId: liker.id, did: liker.did });

    const throwsNotFound: DeleteAtRecord = async () => {
      throw Object.assign(new Error("Could not locate record"), { status: 404 });
    };
    const svc2 = makeService(pds, true, throwsNotFound);
    const state = await svc2.unlike(post, { userId: liker.id, did: liker.did });

    expect(state).toEqual({ likeCount: 0, likedByViewer: false });
    expect(await prisma.like.count({ where: { postId, userId: liker.id } })).toBe(0);

    await cleanup([creator.did, liker.did]);
  });

  it("unlike surfaces a non-404 PDS delete error and keeps the local row", async () => {
    const creator = await makeCreator();
    const liker = await makeUser();
    const postId = await makePostRow(creator.id, "PUBLIC");
    const pds = new FakePds();
    const post = publicPdsPost(postId);
    await makeService(pds, true).like(post, { userId: liker.id, did: liker.did });

    const throws500: DeleteAtRecord = async () => {
      throw Object.assign(new Error("PDS unavailable"), { status: 502 });
    };
    await expect(
      makeService(pds, true, throws500).unlike(post, { userId: liker.id, did: liker.did }),
    ).rejects.toBeInstanceOf(AtRecordDeleteError);
    expect(await prisma.like.count({ where: { postId, userId: liker.id } })).toBe(1);

    await cleanup([creator.did, liker.did]);
  });

  it("getSummary merges local + IndexedLike and dedupes by liker DID", async () => {
    const creator = await makeCreator();
    const localLiker = await makeUser();
    const postId = await makePostRow(creator.id, "PUBLIC");
    const post = publicPdsPost(postId);
    const pds = new FakePds();
    const svc = makeService(pds, true);

    await svc.like(post, { userId: localLiker.id, did: localLiker.did });

    // A network-observed like from a stranger, plus one from the creator, plus a
    // duplicate of the local like (same DID) that must NOT double-count.
    const strangerDid = "did:plc:stranger00000000000000";
    await prisma.indexedLike.createMany({
      data: [
        { uri: `at://${strangerDid}/${NSID.like}/a`, did: strangerDid, subjectUri: post.foryourAtUri!, atCreatedAt: new Date() },
        { uri: `at://${creator.did}/${NSID.like}/b`, did: creator.did, subjectUri: post.canonicalUri!, atCreatedAt: new Date() },
        { uri: `at://${localLiker.did}/${NSID.like}/c`, did: localLiker.did, subjectUri: post.bskyAtUri!, atCreatedAt: new Date() },
      ],
    });

    const summary = await svc.getSummary(
      post,
      { userId: localLiker.id, did: localLiker.did },
      { userId: creator.userId, did: creator.did },
    );
    expect(summary).toEqual({ likeCount: 3, likedByViewer: true, likedByCreator: true });

    await cleanup([creator.did, localLiker.did, strangerDid]);
  });

  it("listLikedBy is newest-first and pages with an opaque cursor", async () => {
    const creator = await makeCreator();
    const postId = await makePostRow(creator.id, "PUBLIC");
    const post = publicPdsPost(postId);
    const pds = new FakePds();
    const svc = makeService(pds, true);

    const likers: string[] = [];
    for (let i = 0; i < 3; i++) {
      const u = await makeUser();
      likers.push(u.did);
      await prisma.like.create({
        data: { postId, userId: u.id, createdAt: new Date(Date.now() + i * 1000) },
      });
    }

    const page1 = await svc.listLikedBy(post, { limit: 2 });
    expect(page1.likes).toHaveLength(2);
    expect(page1.nextCursor).not.toBeNull();
    // newest first
    expect(page1.likes[0]!.createdAt.getTime()).toBeGreaterThan(page1.likes[1]!.createdAt.getTime());

    const page2 = await svc.listLikedBy(post, { limit: 2, cursor: page1.nextCursor! });
    expect(page2.likes).toHaveLength(1);
    expect(page2.nextCursor).toBeNull();

    const seen = new Set([...page1.likes, ...page2.likes].map((a) => a.did));
    expect(seen).toEqual(new Set(likers));

    await cleanup([creator.did, ...likers]);
  });

  it("listLikedBy folds in strangers from IndexedLike, resolving identity where known", async () => {
    const creator = await makeCreator();
    const postId = await makePostRow(creator.id, "PUBLIC");
    const post = publicPdsPost(postId);
    const svc = makeService(new FakePds(), true);

    const strangerDid = "did:plc:stranger11111111111111";
    await prisma.indexedCreatorProfile.create({
      data: { did: strangerDid, handle: "stranger.test", displayName: "A Stranger" },
    });
    await prisma.indexedLike.create({
      data: { uri: `at://${strangerDid}/${NSID.like}/x`, did: strangerDid, subjectUri: post.foryourAtUri!, atCreatedAt: new Date() },
    });

    const page = await svc.listLikedBy(post, { limit: 10 });
    expect(page.likes).toEqual([
      { did: strangerDid, handle: "stranger.test", displayName: "A Stranger", avatarUrl: null, createdAt: expect.any(Date) },
    ]);

    await prisma.indexedCreatorProfile.deleteMany({ where: { did: strangerDid } });
    await cleanup([creator.did, strangerDid]);
  });
});

describe("LikeService.getSummariesForPosts (feed cards)", () => {
  it("returns per-post counts and the viewer's like state (flag off)", async () => {
    const creator = await makeCreator();
    const viewer = await makeUser();
    const other = await makeUser();
    const a = await makePostRow(creator.id, "PUBLIC");
    const b = await makePostRow(creator.id, "PUBLIC");
    const c = await makePostRow(creator.id, "PUBLIC");

    await prisma.like.createMany({
      data: [
        { postId: a, userId: viewer.id },
        { postId: a, userId: other.id },
        { postId: b, userId: other.id },
      ],
    });

    const svc = makeService(new FakePds(), false);
    const map = await svc.getSummariesForPosts(
      [postRecord(a), postRecord(b), postRecord(c)],
      { userId: viewer.id },
    );

    expect(map.get(a)).toEqual({ likeCount: 2, likedByViewer: true });
    expect(map.get(b)).toEqual({ likeCount: 1, likedByViewer: false });
    expect(map.get(c)).toEqual({ likeCount: 0, likedByViewer: false });

    await cleanup([creator.did, viewer.did, other.did]);
  });
});
