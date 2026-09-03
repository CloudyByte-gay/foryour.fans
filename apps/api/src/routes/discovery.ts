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

interface RegisteredCreatorInfo {
  avatarUrl: string | null;
  tierCount: number;
  fromPriceCents: number | null;
  fromPriceCurrency: string | null;
}

/**
 * `isRegisteredCreator` lets a client avoid a dead-end: an indexed profile
 * can come from ANY DID on the open network that publishes
 * fans.foryour.profile, not only ones that have ever signed in here (see
 * docs/architecture.md) — a click-through to `/c/<handle>` for one that
 * hasn't 404s today (findActiveCreatorByIdentifier only knows the local
 * `Creator` table). The rest of `RegisteredCreatorInfo` (avatar, tier count,
 * from-price) is local-only enrichment too — an indexed-but-unregistered
 * profile has no tiers or site avatar in our system, so it gets `null`/`0`,
 * not a guess.
 */
function toDiscoveryResult(profile: IndexedCreatorProfile, registered: Map<string, RegisteredCreatorInfo>) {
  const info = registered.get(profile.did);
  return {
    did: profile.did,
    handle: profile.handle,
    displayName: profile.displayName,
    bio: profile.bio,
    website: profile.website,
    isRegisteredCreator: info !== undefined,
    avatarUrl: info?.avatarUrl ?? null,
    tierCount: info?.tierCount ?? 0,
    fromPriceCents: info?.fromPriceCents ?? null,
    fromPriceCurrency: info?.fromPriceCurrency ?? null,
  };
}

/** Same "site override, else AT-derived" precedence as `toPublicCreator` in routes/creators.ts. */
async function registeredDidsFor(prisma: PrismaClient, dids: string[]): Promise<Map<string, RegisteredCreatorInfo>> {
  if (dids.length === 0) return new Map();
  const creators = await prisma.creator.findMany({
    where: { did: { in: dids }, status: "ACTIVE" },
    select: {
      did: true,
      avatarUrl: true,
      user: { select: { avatarUrl: true } },
      tiers: {
        where: { isActive: true },
        orderBy: { priceCents: "asc" },
        take: 1,
        select: { priceCents: true, currency: true },
      },
      _count: { select: { tiers: { where: { isActive: true } } } },
    },
  });
  return new Map(
    creators.map((c) => [
      c.did,
      {
        avatarUrl: c.avatarUrl ?? c.user.avatarUrl,
        tierCount: c._count.tiers,
        fromPriceCents: c.tiers[0]?.priceCents ?? null,
        fromPriceCurrency: c.tiers[0]?.currency ?? null,
      },
    ]),
  );
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
