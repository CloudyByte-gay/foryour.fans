import { randomUUID } from "node:crypto";
import { getPrismaClient, type PrismaClient } from "@foryour-fans/database";
import { afterAll, describe, expect, it } from "vitest";
import { getLikeState, likePost, unlikePost } from "./likes.js";

const prisma: PrismaClient = getPrismaClient();

function newDid(): string {
  return `did:plc:test${randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

async function makeCreatorAndPost(): Promise<{ creatorDid: string; postId: string }> {
  const did = newDid();
  const user = await prisma.user.create({ data: { did, handle: `${randomUUID().slice(0, 8)}.test` } });
  const creator = await prisma.creator.create({ data: { userId: user.id, did } });
  const post = await prisma.post.create({ data: { creatorId: creator.id, visibility: "PUBLIC", text: "hello" } });
  return { creatorDid: creator.did, postId: post.id };
}

async function makeUser(): Promise<{ id: string; did: string }> {
  const did = newDid();
  const user = await prisma.user.create({ data: { did, handle: `${randomUUID().slice(0, 8)}.test` } });
  return { id: user.id, did: user.did };
}

async function cleanup(dids: string[]): Promise<void> {
  await prisma.like.deleteMany({ where: { user: { did: { in: dids } } } });
  await prisma.like.deleteMany({ where: { post: { creator: { did: { in: dids } } } } });
  await prisma.post.deleteMany({ where: { creator: { did: { in: dids } } } });
  await prisma.creator.deleteMany({ where: { did: { in: dids } } });
  await prisma.user.deleteMany({ where: { did: { in: dids } } });
}

afterAll(async () => {
  await prisma.$disconnect();
});

describe("likePost", () => {
  it("creates a like and returns an incremented count", async () => {
    const { creatorDid, postId } = await makeCreatorAndPost();
    const liker = await makeUser();

    const state = await likePost(prisma, postId, liker.id);

    expect(state).toEqual({ likeCount: 1, likedByViewer: true });

    await cleanup([creatorDid, liker.did]);
  });

  it("is idempotent — liking an already-liked post doesn't duplicate the row or the count", async () => {
    const { creatorDid, postId } = await makeCreatorAndPost();
    const liker = await makeUser();

    await likePost(prisma, postId, liker.id);
    const second = await likePost(prisma, postId, liker.id);

    expect(second).toEqual({ likeCount: 1, likedByViewer: true });
    const rows = await prisma.like.findMany({ where: { postId, userId: liker.id } });
    expect(rows).toHaveLength(1);

    await cleanup([creatorDid, liker.did]);
  });

  it("counts likes from different users independently", async () => {
    const { creatorDid, postId } = await makeCreatorAndPost();
    const alice = await makeUser();
    const bob = await makeUser();

    await likePost(prisma, postId, alice.id);
    const state = await likePost(prisma, postId, bob.id);

    expect(state.likeCount).toBe(2);

    await cleanup([creatorDid, alice.did, bob.did]);
  });
});

describe("unlikePost", () => {
  it("removes an existing like and decrements the count", async () => {
    const { creatorDid, postId } = await makeCreatorAndPost();
    const liker = await makeUser();
    await likePost(prisma, postId, liker.id);

    const state = await unlikePost(prisma, postId, liker.id);

    expect(state).toEqual({ likeCount: 0, likedByViewer: false });

    await cleanup([creatorDid, liker.did]);
  });

  it("is a safe no-op for a post the caller never liked", async () => {
    const { creatorDid, postId } = await makeCreatorAndPost();
    const liker = await makeUser();

    const state = await unlikePost(prisma, postId, liker.id);

    expect(state).toEqual({ likeCount: 0, likedByViewer: false });

    await cleanup([creatorDid, liker.did]);
  });
});

describe("getLikeState", () => {
  it("reports likedByViewer false for an anonymous (null) viewer", async () => {
    const { creatorDid, postId } = await makeCreatorAndPost();
    const liker = await makeUser();
    await likePost(prisma, postId, liker.id);

    const state = await getLikeState(prisma, postId, null);
    expect(state).toEqual({ likeCount: 1, likedByViewer: false });

    await cleanup([creatorDid, liker.did]);
  });

  it("reports likedByViewer true only for the viewer who liked it", async () => {
    const { creatorDid, postId } = await makeCreatorAndPost();
    const liker = await makeUser();
    const other = await makeUser();
    await likePost(prisma, postId, liker.id);

    expect(await getLikeState(prisma, postId, liker.id)).toEqual({ likeCount: 1, likedByViewer: true });
    expect(await getLikeState(prisma, postId, other.id)).toEqual({ likeCount: 1, likedByViewer: false });

    await cleanup([creatorDid, liker.did, other.did]);
  });
});
