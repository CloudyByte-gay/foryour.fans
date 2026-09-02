import type { IndexedCreatorProfile, PrismaClient } from "@foryour-fans/database";

export interface PageOptions {
  limit?: number;
  /** A `did` from a previous page's last result. */
  cursor?: string;
}

const DEFAULT_LIMIT = 20;

/**
 * Newest-indexed-profile-first browse of the discovery index — see
 * prompts/full.md PHASE 10's `/discover`. Reads only `IndexedCreatorProfile`
 * (never `Creator`): this can surface a DID with no local `Creator` row at
 * all, which is the intended behavior for an *AT-network* discovery
 * surface, not a bug — see docs/architecture.md.
 */
export async function listDiscoverableCreators(prisma: PrismaClient, options: PageOptions = {}): Promise<IndexedCreatorProfile[]> {
  return prisma.indexedCreatorProfile.findMany({
    orderBy: [{ indexedAt: "desc" }, { did: "desc" }],
    take: options.limit ?? DEFAULT_LIMIT,
    ...(options.cursor ? { cursor: { did: options.cursor }, skip: 1 } : {}),
  });
}

export interface SearchOptions extends PageOptions {
  query: string;
}

/**
 * Case-insensitive substring search across handle/displayName/bio — see
 * prompts/full.md PHASE 10's "search by: creator name, handle, bio."
 * Plain `contains` matching, not full-text/trigram search — a documented
 * starting point (see README's Known limitations), not a claim of
 * relevance ranking.
 */
export async function searchCreators(prisma: PrismaClient, options: SearchOptions): Promise<IndexedCreatorProfile[]> {
  const query = options.query.trim();
  if (!query) {
    return [];
  }

  return prisma.indexedCreatorProfile.findMany({
    where: {
      OR: [
        { handle: { contains: query, mode: "insensitive" } },
        { displayName: { contains: query, mode: "insensitive" } },
        { bio: { contains: query, mode: "insensitive" } },
      ],
    },
    orderBy: [{ indexedAt: "desc" }, { did: "desc" }],
    take: options.limit ?? DEFAULT_LIMIT,
    ...(options.cursor ? { cursor: { did: options.cursor }, skip: 1 } : {}),
  });
}
