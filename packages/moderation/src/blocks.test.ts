import { getPrismaClient, type PrismaClient } from "@foryour-fans/database";
import { AtRecordPublishError, type DeleteAtRecord, type PublishAtRecord } from "@foryour-fans/atproto";
import { BSKY_NSID } from "@foryour-fans/lexicons";
import { afterAll, describe, expect, it } from "vitest";
import { BlockValidationError, blockUser, isBlockedEitherWay, listBlockedUserIds, unblockUser } from "./blocks.js";
import { cleanupModerationFixtures, createUser } from "./testHelpers.js";

const prisma: PrismaClient = getPrismaClient();
const dids: string[] = [];

afterAll(async () => {
  await cleanupModerationFixtures(prisma, dids);
  await prisma.$disconnect();
});

function fakePublish(): { publish: PublishAtRecord; calls: Array<{ did: string; collection: string; rkey: string }> } {
  const calls: Array<{ did: string; collection: string; rkey: string }> = [];
  return {
    calls,
    publish: async (did, params) => {
      calls.push({ did, collection: params.collection, rkey: params.rkey });
      return { uri: `at://${did}/${params.collection}/${params.rkey}`, cid: "bafyfakecid" };
    },
  };
}

function fakeDelete(): { del: DeleteAtRecord; calls: Array<{ did: string; collection: string; rkey: string }> } {
  const calls: Array<{ did: string; collection: string; rkey: string }> = [];
  return {
    calls,
    del: async (did, params) => {
      calls.push({ did, ...params });
    },
  };
}

describe("blockUser", () => {
  it("publishes an app.bsky.graph.block record and creates the cache row", async () => {
    const blocker = await createUser(prisma);
    const blocked = await createUser(prisma);
    dids.push(blocker.did, blocked.did);
    const { publish, calls } = fakePublish();

    const block = await blockUser(prisma, publish, blocker, blocked);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ did: blocker.did, collection: BSKY_NSID.graphBlock });
    expect(block.blockerUserId).toBe(blocker.id);
    expect(block.blockedUserId).toBe(blocked.id);
    expect(block.atUri).toContain(BSKY_NSID.graphBlock);
  });

  it("is idempotent — blocking twice does not re-publish", async () => {
    const blocker = await createUser(prisma);
    const blocked = await createUser(prisma);
    dids.push(blocker.did, blocked.did);
    const { publish, calls } = fakePublish();

    const first = await blockUser(prisma, publish, blocker, blocked);
    const second = await blockUser(prisma, publish, blocker, blocked);

    expect(calls).toHaveLength(1);
    expect(second.id).toBe(first.id);
  });

  it("rejects self-block", async () => {
    const user = await createUser(prisma);
    dids.push(user.did);
    const { publish } = fakePublish();
    await expect(blockUser(prisma, publish, user, user)).rejects.toThrow(BlockValidationError);
  });

  it("wraps a publish failure in AtRecordPublishError and never writes the row", async () => {
    const blocker = await createUser(prisma);
    const blocked = await createUser(prisma);
    dids.push(blocker.did, blocked.did);
    const failing: PublishAtRecord = async () => {
      throw new Error("PDS unreachable");
    };

    await expect(blockUser(prisma, failing, blocker, blocked)).rejects.toThrow(AtRecordPublishError);
    const row = await prisma.userBlock.findUnique({
      where: { blockerUserId_blockedUserId: { blockerUserId: blocker.id, blockedUserId: blocked.id } },
    });
    expect(row).toBeNull();
  });
});

describe("unblockUser", () => {
  it("deletes the AT record then the local row", async () => {
    const blocker = await createUser(prisma);
    const blocked = await createUser(prisma);
    dids.push(blocker.did, blocked.did);
    const { publish } = fakePublish();
    const { del, calls } = fakeDelete();

    await blockUser(prisma, publish, blocker, blocked);
    await unblockUser(prisma, del, blocker.id, blocked.id);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ did: blocker.did, collection: BSKY_NSID.graphBlock });
    const row = await prisma.userBlock.findUnique({
      where: { blockerUserId_blockedUserId: { blockerUserId: blocker.id, blockedUserId: blocked.id } },
    });
    expect(row).toBeNull();
  });

  it("is a no-op when no block exists", async () => {
    const blocker = await createUser(prisma);
    const blocked = await createUser(prisma);
    dids.push(blocker.did, blocked.did);
    const { del, calls } = fakeDelete();

    await unblockUser(prisma, del, blocker.id, blocked.id);
    expect(calls).toHaveLength(0);
  });
});

describe("isBlockedEitherWay / listBlockedUserIds", () => {
  it("is true regardless of which side blocked", async () => {
    const a = await createUser(prisma);
    const b = await createUser(prisma);
    dids.push(a.did, b.did);
    const { publish } = fakePublish();

    expect(await isBlockedEitherWay(prisma, a.id, b.id)).toBe(false);
    await blockUser(prisma, publish, a, b);
    expect(await isBlockedEitherWay(prisma, a.id, b.id)).toBe(true);
    expect(await isBlockedEitherWay(prisma, b.id, a.id)).toBe(true);
    expect(await listBlockedUserIds(prisma, a.id)).toEqual([b.id]);
  });
});
