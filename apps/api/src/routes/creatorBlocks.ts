import type { CreatorBlock, PrismaClient } from "@foryour-fans/database";
import { blockUserFromCreator, listCreatorBlocks, unblockUserFromCreator } from "@foryour-fans/moderation";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireCsrf, requireSession } from "../plugins/session.js";
import { findUserByIdentifier } from "../services/users.js";

export interface CreatorBlocksRoutesOptions {
  prisma: PrismaClient;
}

const createCreatorBlockBodySchema = z.object({
  identifier: z.string().trim().min(1, "identifier is required"),
  reason: z.string().trim().max(2000).optional(),
});

function toCreatorBlockResponse(block: CreatorBlock) {
  return { blockedUserId: block.blockedUserId, reason: block.reason, createdAt: block.createdAt };
}

/**
 * Phase 14 — a creator banning a specific user from their own content/
 * comments (CreatorBlock; Postgres-only, no AT record — see that model's
 * doc comment in schema.prisma). Distinct from the generic /blocks routes.
 */
export async function creatorBlocksRoutes(app: FastifyInstance, { prisma }: CreatorBlocksRoutesOptions): Promise<void> {
  app.post("/creators/me/blocks", { preHandler: [requireSession, requireCsrf] }, async (request, reply) => {
    const creator = await prisma.creator.findUnique({ where: { did: request.session!.did } });
    if (!creator) {
      return reply.status(404).send({ error: { message: "Not a creator yet.", statusCode: 404 } });
    }

    const parsed = createCreatorBlockBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { message: parsed.error.issues[0]?.message ?? "Invalid input.", statusCode: 400 } });
    }

    const blocked = await findUserByIdentifier(prisma, parsed.data.identifier);
    if (!blocked) {
      return reply.status(404).send({ error: { message: "User not found.", statusCode: 404 } });
    }

    const block = await blockUserFromCreator(prisma, creator, blocked.id, parsed.data.reason);
    return reply.status(201).send(toCreatorBlockResponse(block));
  });

  app.delete("/creators/me/blocks/:identifier", { preHandler: [requireSession, requireCsrf] }, async (request, reply) => {
    const creator = await prisma.creator.findUnique({ where: { did: request.session!.did } });
    if (!creator) {
      return reply.status(404).send({ error: { message: "Not a creator yet.", statusCode: 404 } });
    }

    const { identifier } = request.params as { identifier: string };
    const blocked = await findUserByIdentifier(prisma, identifier);
    if (blocked) {
      await unblockUserFromCreator(prisma, creator.id, blocked.id);
    }
    return reply.status(204).send();
  });

  app.get("/creators/me/blocks", { preHandler: [requireSession] }, async (request, reply) => {
    const creator = await prisma.creator.findUnique({ where: { did: request.session!.did } });
    if (!creator) {
      return reply.status(404).send({ error: { message: "Not a creator yet.", statusCode: 404 } });
    }

    const blocks = await listCreatorBlocks(prisma, creator.id);
    const blockedUsers = await prisma.user.findMany({
      where: { id: { in: blocks.map((b) => b.blockedUserId) } },
      select: { id: true, did: true, handle: true, displayName: true },
    });
    const byId = new Map(blockedUsers.map((u) => [u.id, u]));

    return blocks.map((block) => ({ ...toCreatorBlockResponse(block), user: byId.get(block.blockedUserId) ?? null }));
  });
}
