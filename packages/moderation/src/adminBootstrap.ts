import type { PrismaClient } from "@foryour-fans/database";

/**
 * Promotes a DID to ADMIN if it's listed in the ADMIN_DIDS env var (see
 * apps/api/src/config/env.ts) — called once per login
 * (apps/api/src/routes/auth.ts, right after syncUserFromProfile), never
 * exposed as an API route. Idempotent, and deliberately one-directional:
 * removing a DID from ADMIN_DIDS does not demote it here — an operator who
 * needs to demote an admin does so directly in the database, the same way
 * every other break-glass admin action in this codebase (there is no
 * "admin management" UI, by design — see docs/architecture.md's Phase 14
 * section for why a full RBAC system is out of scope).
 */
export async function promoteAdminIfConfigured(prisma: PrismaClient, did: string, adminDids: readonly string[]): Promise<void> {
  if (!adminDids.includes(did)) {
    return;
  }

  const user = await prisma.user.findUnique({ where: { did } });
  if (!user || user.role === "ADMIN") {
    return;
  }

  await prisma.user.update({ where: { did }, data: { role: "ADMIN" } });
}
