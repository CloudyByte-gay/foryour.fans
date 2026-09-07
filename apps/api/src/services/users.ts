import type { PrismaClient, User } from "@foryour-fans/database";

/**
 * Resolves a generic User (not necessarily a creator) by AT handle or DID —
 * the same handle-or-did dispatch `resolveCreatorByIdentifier`
 * (./creators.ts) uses, but against `User` directly, for Phase 14's
 * blocking routes (any user can be blocked, not just creators). Unlike
 * creator resolution, there is no handle-history fallback here — blocking
 * is keyed by identity right now, not a durable public page address, so a
 * stale handle simply doesn't resolve.
 */
export async function findUserByIdentifier(prisma: PrismaClient, identifier: string): Promise<User | null> {
  if (identifier.startsWith("did:")) {
    return prisma.user.findUnique({ where: { did: identifier } });
  }
  return prisma.user.findFirst({ where: { handle: identifier.toLowerCase() } });
}
