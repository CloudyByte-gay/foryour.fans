import type { PrismaClient, User } from "@foryour-fans/database";
import type { AtprotoProfile } from "@foryour-fans/atproto";

/**
 * Upserts the local User row keyed on the immutable DID. Handle/displayName/
 * avatarUrl are always overwritten with whatever the PDS says right now —
 * they are cached, mutable data (see prompts/full.md "Hosting model"), never
 * used to look the user up.
 *
 * Handle history: when this overwrites `handle` for a DID that already has a
 * `Creator` row, it first appends a `CreatorHandleHistory` row for the
 * *previous* handle. That's what lets an old `/c/<oldhandle>` link
 * 301-redirect to the current handle instead of 404ing (see
 * apps/api/src/services/creators.ts#resolveCreatorByIdentifier). This
 * piggybacks on the existing login-time profile sync — no new network calls
 * on any hot path; cross-session/real-time handle tracking is still Phase
 * 10's job.
 */
export async function syncUserFromProfile(prisma: PrismaClient, profile: AtprotoProfile): Promise<User> {
  const existing = await prisma.user.findUnique({
    where: { did: profile.did },
    include: { creator: { select: { id: true } } },
  });

  const handleChanged =
    existing?.handle != null &&
    profile.handle != null &&
    existing.handle.toLowerCase() !== profile.handle.toLowerCase();

  if (existing?.creator && handleChanged) {
    await prisma.creatorHandleHistory.create({
      data: {
        creatorId: existing.creator.id,
        did: profile.did,
        previousHandle: existing.handle!.toLowerCase(),
      },
    });
  }

  return prisma.user.upsert({
    where: { did: profile.did },
    create: {
      did: profile.did,
      handle: profile.handle,
      displayName: profile.displayName,
      avatarUrl: profile.avatarUrl,
    },
    update: {
      handle: profile.handle,
      displayName: profile.displayName,
      avatarUrl: profile.avatarUrl,
    },
  });
}
