import { getPrismaClient, type PrismaClient } from "@foryour-fans/database";
import { afterAll, describe, expect, it } from "vitest";
import { approveVerification, rejectVerification, submitVerification, VerificationStateError } from "./verification.js";
import { cleanupModerationFixtures, createCreator, createUser } from "./testHelpers.js";

const prisma: PrismaClient = getPrismaClient();
const dids: string[] = [];

afterAll(async () => {
  await cleanupModerationFixtures(prisma, dids);
  await prisma.$disconnect();
});

describe("verification lifecycle", () => {
  it("UNVERIFIED -> PENDING -> VERIFIED, each step logged", async () => {
    const admin = await createUser(prisma, { role: "ADMIN" });
    const { creator, user } = await createCreator(prisma);
    dids.push(admin.did, user.did);
    expect(creator.verificationStatus).toBe("UNVERIFIED");

    const pending = await submitVerification(prisma, creator);
    expect(pending.verificationStatus).toBe("PENDING");

    const verified = await approveVerification(prisma, admin, creator.id);
    expect(verified.verificationStatus).toBe("VERIFIED");

    const logs = await prisma.auditLog.findMany({ where: { targetType: "CREATOR", targetId: creator.id }, orderBy: { createdAt: "asc" } });
    expect(logs.map((l) => l.action)).toEqual(["CREATOR_VERIFICATION_SUBMITTED", "CREATOR_VERIFICATION_APPROVED"]);
  });

  it("rejects a submission from a non-UNVERIFIED creator", async () => {
    const { creator, user } = await createCreator(prisma);
    dids.push(user.did);
    await submitVerification(prisma, creator);
    const pending = await prisma.creator.findUniqueOrThrow({ where: { id: creator.id } });

    await expect(submitVerification(prisma, pending)).rejects.toThrow(VerificationStateError);
  });

  it("rejectVerification resets PENDING back to UNVERIFIED", async () => {
    const admin = await createUser(prisma, { role: "ADMIN" });
    const { creator, user } = await createCreator(prisma);
    dids.push(admin.did, user.did);
    await submitVerification(prisma, creator);

    const rejected = await rejectVerification(prisma, admin, creator.id, "documents unreadable");
    expect(rejected.verificationStatus).toBe("UNVERIFIED");

    const log = await prisma.auditLog.findFirst({ where: { action: "CREATOR_VERIFICATION_REJECTED", targetId: creator.id } });
    expect(log?.metadata).toMatchObject({ note: "documents unreadable" });
  });

  it("approveVerification is idempotent once already VERIFIED", async () => {
    const admin = await createUser(prisma, { role: "ADMIN" });
    const { creator, user } = await createCreator(prisma);
    dids.push(admin.did, user.did);
    await submitVerification(prisma, creator);
    await approveVerification(prisma, admin, creator.id);

    await approveVerification(prisma, admin, creator.id);
    const logs = await prisma.auditLog.findMany({ where: { action: "CREATOR_VERIFICATION_APPROVED", targetId: creator.id } });
    expect(logs).toHaveLength(1);
  });
});
