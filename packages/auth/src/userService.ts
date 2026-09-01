import type { PrismaClient, User } from "@foryour-fans/database";
import type { AtprotoProfile } from "@foryour-fans/atproto";

/**
 * Upserts the local User row keyed on the immutable DID. Handle/displayName/
 * avatarUrl are always overwritten with whatever the PDS says right now —
 * they are cached, mutable data (see prompts/full.md "Hosting model"), never
 * used to look the user up.
 */
export async function syncUserFromProfile(prisma: PrismaClient, profile: AtprotoProfile): Promise<User> {
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
