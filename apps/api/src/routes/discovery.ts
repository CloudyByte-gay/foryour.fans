import type { IndexedCreatorProfile, PrismaClient } from "@foryour-fans/database";
import { listDiscoverableCreators, searchCreators } from "@foryour-fans/discovery";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

export interface DiscoveryRoutesOptions {
  prisma: PrismaClient;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const pageQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(MAX_LIMIT).optional(),
  cursor: z.string().min(1).optional(),
});

const searchQuerySchema = pageQuerySchema.extend({
  q: z.string().min(1),
});

/**
 * `isRegisteredCreator` lets a client avoid a dead-end: an indexed profile
 * can come from ANY DID on the open network that publishes
 * fans.foryour.profile, not only ones that have ever signed in here (see
 * docs/architecture.md) — a click-through to `/c/<handle>` for one that
 * hasn't 404s today (findActiveCreatorByIdentifier only knows the local
 * `Creator` table). This flag is the one piece of enrichment this route
 * adds beyond the index itself.
 */
function toDiscoveryResult(profile: IndexedCreatorProfile, registeredDids: Set<string>) {
  return {
    did: profile.did,
    handle: profile.handle,
    displayName: profile.displayName,
    bio: profile.bio,
    website: profile.website,
    isRegisteredCreator: registeredDids.has(profile.did),
  };
}

async function registeredDidsFor(prisma: PrismaClient, dids: string[]): Promise<Set<string>> {
  if (dids.length === 0) return new Set();
  const creators = await prisma.creator.findMany({ where: { did: { in: dids }, status: "ACTIVE" }, select: { did: true } });
  return new Set(creators.map((c) => c.did));
}

function parsePage(request: FastifyRequest, reply: FastifyReply): { limit: number; cursor?: string } | null {
  const parsed = pageQuerySchema.safeParse(request.query);
  if (!parsed.success) {
    reply.status(400).send({ error: { message: parsed.error.issues[0]?.message ?? "Invalid query.", statusCode: 400 } });
    return null;
  }
  return { limit: parsed.data.limit ?? DEFAULT_LIMIT, cursor: parsed.data.cursor };
}

/**
 * Phase 10's public discovery surface — see docs/architecture.md and
 * packages/discovery. Both routes read only the `IndexedCreatorProfile`
 * table (Jetstream-derived), never `Creator` directly — this is
 * deliberately an AT-network-wide view, not a listing of our own
 * registered creators.
 */
export async function discoveryRoutes(app: FastifyInstance, { prisma }: DiscoveryRoutesOptions): Promise<void> {
  app.get("/discover", async (request, reply) => {
    const page = parsePage(request, reply);
    if (!page) return;

    const profiles = await listDiscoverableCreators(prisma, page);
    const registered = await registeredDidsFor(prisma, profiles.map((p) => p.did));

    return {
      creators: profiles.map((p) => toDiscoveryResult(p, registered)),
      nextCursor: profiles.length > 0 ? profiles[profiles.length - 1]!.did : null,
    };
  });

  app.get("/search", async (request, reply) => {
    const parsed = searchQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { message: parsed.error.issues[0]?.message ?? "Invalid query.", statusCode: 400 } });
    }

    const profiles = await searchCreators(prisma, {
      query: parsed.data.q,
      limit: parsed.data.limit ?? DEFAULT_LIMIT,
      cursor: parsed.data.cursor,
    });
    const registered = await registeredDidsFor(prisma, profiles.map((p) => p.did));

    return {
      creators: profiles.map((p) => toDiscoveryResult(p, registered)),
      nextCursor: profiles.length > 0 ? profiles[profiles.length - 1]!.did : null,
    };
  });
}
