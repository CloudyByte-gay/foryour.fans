import type { PrismaClient } from "@foryour-fans/database";
import type { ContentRepository } from "@foryour-fans/content";
import {
  DashboardRangeError,
  getCreatorDashboard,
  getPayoutAccountStatus,
  normalizeDashboardRange,
  type PayoutProvider,
} from "@foryour-fans/subscriptions";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireSession } from "../plugins/session.js";

export interface DashboardRoutesOptions {
  prisma: PrismaClient;
  contentRepository: ContentRepository;
  payoutProvider: PayoutProvider;
}

const DEFAULT_RANGE_DAYS = 30;
const RECENT_POSTS_LIMIT = 5;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const querySchema = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
});

function defaultRange(): { start: Date; end: Date } {
  const end = new Date();
  const start = new Date(end.getTime() - (DEFAULT_RANGE_DAYS - 1) * MS_PER_DAY);
  return { start, end };
}

/**
 * `GET /creators/me/dashboard` — prompts/full.md PHASE 13. Ownership is
 * implicit in every field it reads: the creator is resolved from the
 * session's own DID (`request.session!.did`), never from a client-supplied
 * id, the same discipline every other `/creators/me/*` route uses (see
 * apps/api/src/routes/tiers.ts, payouts.ts). A non-creator session gets 404,
 * never another creator's numbers.
 */
export async function dashboardRoutes(
  app: FastifyInstance,
  { prisma, contentRepository, payoutProvider }: DashboardRoutesOptions,
): Promise<void> {
  app.get("/creators/me/dashboard", { preHandler: [requireSession] }, async (request, reply) => {
    const creator = await prisma.creator.findUnique({ where: { did: request.session!.did } });
    if (!creator) {
      return reply.status(404).send({ error: { message: "Not a creator yet.", statusCode: 404 } });
    }

    const parsedQuery = querySchema.safeParse(request.query);
    if (!parsedQuery.success) {
      return reply
        .status(400)
        .send({ error: { message: parsedQuery.error.issues[0]?.message ?? "Invalid query.", statusCode: 400 } });
    }

    const { from, to } = parsedQuery.data;
    const requested = from || to ? { start: from ? new Date(from) : defaultRange().start, end: to ? new Date(to) : new Date() } : defaultRange();

    let range;
    try {
      range = normalizeDashboardRange(requested.start, requested.end);
    } catch (error) {
      if (error instanceof DashboardRangeError) {
        return reply.status(400).send({ error: { message: error.message, statusCode: 400 } });
      }
      throw error;
    }

    const [dashboard, payoutAccount, recentPosts] = await Promise.all([
      getCreatorDashboard(prisma, creator, range),
      getPayoutAccountStatus(prisma, payoutProvider, creator.id),
      contentRepository.getCreatorFeed(creator.id, { limit: RECENT_POSTS_LIMIT }),
    ]);

    return {
      ...dashboard,
      payout: payoutAccount ? { status: payoutAccount.status, provider: payoutAccount.provider } : null,
      recentPosts: recentPosts.map((post) => ({
        id: post.id,
        visibility: post.visibility,
        text: post.text,
        mediaCount: post.media.length,
        createdAt: post.createdAt,
      })),
    };
  });
}
