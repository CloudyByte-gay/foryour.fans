import { getPrismaClient, type PrismaClient } from "@foryour-fans/database";
import { afterAll, describe, expect, it } from "vitest";
import { blockUserFromCreator, isBlockedByCreator, listCreatorBlocks, unblockUserFromCreator } from "./creatorBlocks.js";
import { cleanupModerationFixtures, createCreator, createUser } from "./testHelpers.js";

const prisma: PrismaClient = getPrismaClient();
const dids: string[] = [];

afterAll(async () => {
  await cleanupModerationFixtures(prisma, dids);
  await prisma.$disconnect();
});

describe("CreatorBlock", () => {
  it("blocks and unblocks a user from a creator's content, with no AT record involved", async () => {
    const { creator, user: creatorUser } = await createCreator(prisma);
    const target = await createUser(prisma);
    dids.push(creatorUser.did, target.did);

    expect(await isBlockedByCreator(prisma, creator.id, target.id)).toBe(false);

    await blockUserFromCreator(prisma, creator, target.id, "harassment in comments");
    expect(await isBlockedByCreator(prisma, creator.id, target.id)).toBe(true);
    expect(await listCreatorBlocks(prisma, creator.id)).toHaveLength(1);

    await unblockUserFromCreator(prisma, creator.id, target.id);
    expect(await isBlockedByCreator(prisma, creator.id, target.id)).toBe(false);
  });

  it("blocking twice is idempotent", async () => {
    const { creator, user: creatorUser } = await createCreator(prisma);
    const target = await createUser(prisma);
    dids.push(creatorUser.did, target.did);

    await blockUserFromCreator(prisma, creator, target.id);
    await blockUserFromCreator(prisma, creator, target.id);
    expect(await listCreatorBlocks(prisma, creator.id)).toHaveLength(1);
  });

  it("does not affect the reverse direction or other platform behavior", async () => {
    const { creator, user: creatorUser } = await createCreator(prisma);
    const target = await createUser(prisma);
    dids.push(creatorUser.did, target.did);

    await blockUserFromCreator(prisma, creator, target.id);
    expect(await isBlockedByCreator(prisma, creator.id, creatorUser.id)).toBe(false);
  });
});
