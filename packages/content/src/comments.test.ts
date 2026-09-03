import { randomUUID } from "node:crypto";
import { getPrismaClient, type PrismaClient } from "@foryour-fans/database";
import { afterAll, describe, expect, it } from "vitest";
import { CommentValidationError, createComment, listComments } from "./comments.js";

const prisma: PrismaClient = getPrismaClient();

function newDid(): string {
  return `did:plc:test${randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

async function makeCreatorAndPost(): Promise<{ creatorId: string; creatorDid: string; postId: string }> {
  const did = newDid();
  const user = await prisma.user.create({ data: { did, handle: `${randomUUID().slice(0, 8)}.test` } });
  const creator = await prisma.creator.create({ data: { userId: user.id, did } });
  const post = await prisma.post.create({ data: { creatorId: creator.id, visibility: "PUBLIC", text: "hello" } });
  return { creatorId: creator.id, creatorDid: creator.did, postId: post.id };
}

async function makeUser(): Promise<{ id: string; did: string }> {
  const did = newDid();
  const user = await prisma.user.create({ data: { did, handle: `${randomUUID().slice(0, 8)}.test` } });
  return { id: user.id, did: user.did };
}

async function cleanup(dids: string[]): Promise<void> {
  await prisma.comment.deleteMany({ where: { authorUser: { did: { in: dids } } } });
  await prisma.comment.deleteMany({ where: { post: { creator: { did: { in: dids } } } } });
  await prisma.post.deleteMany({ where: { creator: { did: { in: dids } } } });
  await prisma.creator.deleteMany({ where: { did: { in: dids } } });
  await prisma.user.deleteMany({ where: { did: { in: dids } } });
}

afterAll(async () => {
  await prisma.$disconnect();
});

describe("createComment", () => {
  it("creates a comment and returns the author's identity", async () => {
    const { creatorDid, postId } = await makeCreatorAndPost();
    const author = await makeUser();

    const comment = await createComment(prisma, postId, author.id, "  nice post  ");

    expect(comment.postId).toBe(postId);
    // Text is trimmed before storage.
    expect(comment.text).toBe("nice post");
    expect(comment.author.did).toBe(author.did);

    await cleanup([creatorDid, author.did]);
  });

  it("rejects empty (or whitespace-only) text", async () => {
    const { creatorDid, postId } = await makeCreatorAndPost();
    const author = await makeUser();

    await expect(createComment(prisma, postId, author.id, "   ")).rejects.toThrow(CommentValidationError);

    await cleanup([creatorDid, author.did]);
  });

  it("rejects text over the length limit", async () => {
    const { creatorDid, postId } = await makeCreatorAndPost();
    const author = await makeUser();

    await expect(createComment(prisma, postId, author.id, "a".repeat(2001))).rejects.toThrow(CommentValidationError);

    await cleanup([creatorDid, author.did]);
  });
});

describe("listComments", () => {
  it("returns comments oldest-first", async () => {
    const { creatorDid, postId } = await makeCreatorAndPost();
    const author = await makeUser();

    await createComment(prisma, postId, author.id, "first");
    await createComment(prisma, postId, author.id, "second");
    await createComment(prisma, postId, author.id, "third");

    const comments = await listComments(prisma, postId);
    expect(comments.map((c) => c.text)).toEqual(["first", "second", "third"]);

    await cleanup([creatorDid, author.did]);
  });

  it("only returns comments for the requested post", async () => {
    const a = await makeCreatorAndPost();
    const author = await makeUser();
    await createComment(prisma, a.postId, author.id, "on post a");

    const b = await makeCreatorAndPost();
    await createComment(prisma, b.postId, author.id, "on post b");

    const comments = await listComments(prisma, a.postId);
    expect(comments).toHaveLength(1);
    expect(comments[0]?.text).toBe("on post a");

    await cleanup([a.creatorDid, b.creatorDid, author.did]);
  });

  it("paginates with a cursor, without skipping or repeating rows", async () => {
    const { creatorDid, postId } = await makeCreatorAndPost();
    const author = await makeUser();
    const created = [];
    for (let i = 0; i < 5; i++) {
      created.push(await createComment(prisma, postId, author.id, `comment ${i}`));
    }

    const firstPage = await listComments(prisma, postId, { limit: 2 });
    expect(firstPage).toHaveLength(2);
    const secondPage = await listComments(prisma, postId, { limit: 2, cursor: firstPage[1]!.id });
    expect(secondPage).toHaveLength(2);
    const thirdPage = await listComments(prisma, postId, { limit: 2, cursor: secondPage[1]!.id });
    expect(thirdPage).toHaveLength(1);

    const seenIds = [...firstPage, ...secondPage, ...thirdPage].map((c) => c.id);
    expect(new Set(seenIds).size).toBe(5);
    expect(seenIds).toEqual(created.map((c) => c.id));

    await cleanup([creatorDid, author.did]);
  });
});
