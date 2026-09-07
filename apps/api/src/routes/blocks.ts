import type { PrismaClient, UserBlock } from "@foryour-fans/database";
import { AtRecordDeleteError, AtRecordPublishError, type DeleteAtRecord, type PublishAtRecord } from "@foryour-fans/atproto";
import { BlockValidationError, blockUser, listBlocks, unblockUser } from "@foryour-fans/moderation";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { requireCsrf, requireNotRestricted, requireSession } from "../plugins/session.js";
import { findUserByIdentifier } from "../services/users.js";

export interface BlocksRoutesOptions {
  prisma: PrismaClient;
  publishAtRecord: PublishAtRecord;
  deleteAtRecord: DeleteAtRecord;
}

const createBlockBodySchema = z.object({
  identifier: z.string().trim().min(1, "identifier is required"),
});

function toBlockResponse(block: UserBlock) {
  return { blockedUserId: block.blockedUserId, createdAt: block.createdAt };
}

function sendBlockError(error: unknown, reply: FastifyReply): FastifyReply {
  if (error instanceof BlockValidationError) {
    return reply.status(400).send({ error: { message: error.message, statusCode: 400 } });
  }
  if (error instanceof AtRecordPublishError || error instanceof AtRecordDeleteError) {
    reply.log.error({ err: error.cause }, "failed to sync block to AT network");
    return reply.status(502).send({ error: { message: error.message, statusCode: 502 } });
  }
  throw error;
}

/**
 * Phase 14 — generic user-to-user blocking, backed by a real
 * `app.bsky.graph.block` record (see packages/atproto/src/bskyBlock.ts and
 * packages/moderation/src/blocks.ts for why). `identifier` is a handle or
 * DID, resolved the same way every other "look up a person" route in this
 * codebase does.
 */
export async function blocksRoutes(app: FastifyInstance, { prisma, publishAtRecord, deleteAtRecord }: BlocksRoutesOptions): Promise<void> {
  app.post("/blocks", { preHandler: [requireSession, requireCsrf, requireNotRestricted(prisma)] }, async (request, reply) => {
    const parsed = createBlockBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { message: parsed.error.issues[0]?.message ?? "Invalid input.", statusCode: 400 } });
    }

    const blocker = await prisma.user.findUnique({ where: { did: request.session!.did } });
    if (!blocker) {
      return reply.status(401).send({ error: { message: "Session user not found.", statusCode: 401 } });
    }

    const blocked = await findUserByIdentifier(prisma, parsed.data.identifier);
    if (!blocked) {
      return reply.status(404).send({ error: { message: "User not found.", statusCode: 404 } });
    }

    try {
      const block = await blockUser(prisma, publishAtRecord, blocker, blocked);
      return reply.status(201).send(toBlockResponse(block));
    } catch (error) {
      return sendBlockError(error, reply);
    }
  });

  app.delete("/blocks/:identifier", { preHandler: [requireSession, requireCsrf] }, async (request, reply) => {
    const { identifier } = request.params as { identifier: string };

    const blocker = await prisma.user.findUnique({ where: { did: request.session!.did } });
    if (!blocker) {
      return reply.status(401).send({ error: { message: "Session user not found.", statusCode: 401 } });
    }

    const blocked = await findUserByIdentifier(prisma, identifier);
    if (!blocked) {
      return reply.status(204).send();
    }

    try {
      await unblockUser(prisma, deleteAtRecord, blocker.id, blocked.id);
    } catch (error) {
      return sendBlockError(error, reply);
    }
    return reply.status(204).send();
  });

  app.get("/blocks", { preHandler: [requireSession] }, async (request) => {
    const blocker = await prisma.user.findUnique({ where: { did: request.session!.did } });
    if (!blocker) {
      return [];
    }

    const blocks = await listBlocks(prisma, blocker.id);
    const blockedUsers = await prisma.user.findMany({
      where: { id: { in: blocks.map((b) => b.blockedUserId) } },
      select: { id: true, did: true, handle: true, displayName: true },
    });
    const byId = new Map(blockedUsers.map((u) => [u.id, u]));

    return blocks.map((block) => ({
      ...toBlockResponse(block),
      user: byId.get(block.blockedUserId) ?? null,
    }));
  });
}
