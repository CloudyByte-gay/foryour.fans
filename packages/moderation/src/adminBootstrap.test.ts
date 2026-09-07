import { getPrismaClient, type PrismaClient } from "@foryour-fans/database";
import { afterAll, describe, expect, it } from "vitest";
import { promoteAdminIfConfigured } from "./adminBootstrap.js";
import { cleanupModerationFixtures, createUser } from "./testHelpers.js";

const prisma: PrismaClient = getPrismaClient();
const dids: string[] = [];

afterAll(async () => {
  await cleanupModerationFixtures(prisma, dids);
  await prisma.$disconnect();
});

describe("promoteAdminIfConfigured", () => {
  it("promotes a DID listed in ADMIN_DIDS", async () => {
    const user = await createUser(prisma);
    dids.push(user.did);

    await promoteAdminIfConfigured(prisma, user.did, [user.did]);
    const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(updated.role).toBe("ADMIN");
  });

  it("leaves an unlisted DID as USER", async () => {
    const user = await createUser(prisma);
    dids.push(user.did);

    await promoteAdminIfConfigured(prisma, user.did, ["did:plc:someoneelse"]);
    const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(updated.role).toBe("USER");
  });

  it("is a no-op when the DID has no local User row yet", async () => {
    await expect(promoteAdminIfConfigured(prisma, "did:plc:doesnotexist", ["did:plc:doesnotexist"])).resolves.toBeUndefined();
  });
});
