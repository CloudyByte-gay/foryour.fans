import type { Creator, PrismaClient, User } from "@foryour-fans/database";

export class VerificationStateError extends Error {}

/**
 * Elevates `Creator.verificationStatus` UNVERIFIED -> PENDING. This is a
 * placeholder for a real KYC submission — prompts/full.md's Phase 14 note
 * is explicit that pulling identity verification forward is "a design/
 * gating requirement, not an instruction to integrate a specific KYC
 * vendor". No document upload, no vendor call, no PII collection happens
 * here; a real integration replaces this function's body, not its callers
 * (apps/api/src/routes/verification.ts) or the gate that reads
 * `verificationStatus` (posts.ts/tiers.ts adult-content flag,
 * docs/architecture.md's payout-onboarding note).
 */
export async function submitVerification(prisma: PrismaClient, creator: Creator): Promise<Creator> {
  if (creator.verificationStatus !== "UNVERIFIED") {
    throw new VerificationStateError(`Cannot submit for verification from status ${creator.verificationStatus}.`);
  }

  const updated = await prisma.creator.update({ where: { id: creator.id }, data: { verificationStatus: "PENDING" } });
  await prisma.auditLog.create({
    data: {
      actorUserId: creator.userId,
      actorRole: "USER",
      action: "CREATOR_VERIFICATION_SUBMITTED",
      targetType: "CREATOR",
      targetId: creator.id,
    },
  });
  return updated;
}

export async function approveVerification(prisma: PrismaClient, admin: User, creatorId: string): Promise<Creator> {
  const creator = await prisma.creator.findUnique({ where: { id: creatorId } });
  if (!creator) {
    throw new VerificationStateError("Creator not found.");
  }
  if (creator.verificationStatus === "VERIFIED") {
    return creator;
  }

  const updated = await prisma.creator.update({ where: { id: creatorId }, data: { verificationStatus: "VERIFIED" } });
  await prisma.auditLog.create({
    data: {
      actorUserId: admin.id,
      actorRole: admin.role,
      action: "CREATOR_VERIFICATION_APPROVED",
      targetType: "CREATOR",
      targetId: creatorId,
    },
  });
  return updated;
}

export async function rejectVerification(prisma: PrismaClient, admin: User, creatorId: string, note?: string): Promise<Creator> {
  const creator = await prisma.creator.findUnique({ where: { id: creatorId } });
  if (!creator) {
    throw new VerificationStateError("Creator not found.");
  }
  if (creator.verificationStatus === "UNVERIFIED") {
    return creator;
  }

  const updated = await prisma.creator.update({ where: { id: creatorId }, data: { verificationStatus: "UNVERIFIED" } });
  await prisma.auditLog.create({
    data: {
      actorUserId: admin.id,
      actorRole: admin.role,
      action: "CREATOR_VERIFICATION_REJECTED",
      targetType: "CREATOR",
      targetId: creatorId,
      metadata: note ? { note } : undefined,
    },
  });
  return updated;
}
