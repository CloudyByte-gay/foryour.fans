import type { Creator, PrismaClient } from "@foryour-fans/database";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { requireCsrf, requireSession } from "../plugins/session.js";
import { AtRecordPublishError, type PublishAtRecord } from "@foryour-fans/atproto";
import {
  AlreadyACreatorError,
  SlugCooldownError,
  SlugTakenError,
  SlugValidationError,
  createCreator,
  findActiveCreatorByIdentifier,
  updateCreator,
} from "../services/creators.js";

export interface CreatorsRoutesOptions {
  prisma: PrismaClient;
  publishAtRecord: PublishAtRecord;
}

const profileFieldsSchema = {
  displayName: z.string().trim().max(640).optional(),
  bio: z.string().trim().max(20000).optional(),
  website: z.string().trim().url().max(2048).optional().or(z.literal("")),
};

const createBodySchema = z.object({
  slug: z.string().trim().toLowerCase(),
  ...profileFieldsSchema,
});

const updateBodySchema = z.object({
  slug: z.string().trim().toLowerCase().optional(),
  ...profileFieldsSchema,
});

function toPublicCreator(creator: Creator) {
  return {
    did: creator.did,
    slug: creator.slug,
    displayName: creator.displayName,
    bio: creator.bio,
    website: creator.website,
    createdAt: creator.createdAt,
  };
}

function toOwnCreator(creator: Creator) {
  return {
    did: creator.did,
    slug: creator.slug,
    displayName: creator.displayName,
    bio: creator.bio,
    website: creator.website,
    status: creator.status,
    verificationStatus: creator.verificationStatus,
    createdAt: creator.createdAt,
    updatedAt: creator.updatedAt,
  };
}

/** Empty-string website from the form means "clear it" — undefined means "leave it". */
function normalizeWebsite(website: string | undefined): string | undefined {
  return website === "" ? undefined : website;
}

/** Maps the creators-service's typed errors to HTTP responses. Rethrows anything it doesn't recognize, letting the global error handler take it (see plugins/error-handler.ts). */
function sendCreatorError(error: unknown, reply: FastifyReply): FastifyReply {
  if (error instanceof SlugValidationError) {
    return reply.status(400).send({ error: { message: error.message, statusCode: 400 } });
  }
  if (error instanceof SlugTakenError) {
    return reply.status(409).send({ error: { message: error.message, statusCode: 409 } });
  }
  if (error instanceof AlreadyACreatorError) {
    return reply.status(409).send({ error: { message: error.message, statusCode: 409 } });
  }
  if (error instanceof SlugCooldownError) {
    return reply.status(429).send({ error: { message: error.message, statusCode: 429 } });
  }
  if (error instanceof AtRecordPublishError) {
    reply.log.error({ err: error.cause }, "failed to publish AT record");
    return reply.status(502).send({ error: { message: error.message, statusCode: 502 } });
  }
  throw error;
}

export async function creatorsRoutes(
  app: FastifyInstance,
  { prisma, publishAtRecord }: CreatorsRoutesOptions,
): Promise<void> {
  app.post("/creators", { preHandler: [requireSession, requireCsrf] }, async (request, reply) => {
    const parsed = createBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { message: parsed.error.issues[0]?.message ?? "Invalid input.", statusCode: 400 } });
    }

    const did = request.session!.did;
    const user = await prisma.user.findUniqueOrThrow({ where: { did } });

    try {
      const creator = await createCreator(prisma, publishAtRecord, {
        did,
        userId: user.id,
        slug: parsed.data.slug,
        profile: {
          displayName: parsed.data.displayName,
          bio: parsed.data.bio,
          website: normalizeWebsite(parsed.data.website),
        },
      });
      return reply.status(201).send(toOwnCreator(creator));
    } catch (error) {
      return sendCreatorError(error, reply);
    }
  });

  app.get("/creators/me", { preHandler: [requireSession] }, async (request, reply) => {
    const creator = await prisma.creator.findUnique({ where: { did: request.session!.did } });
    if (!creator) {
      return reply.status(404).send({ error: { message: "Not a creator yet.", statusCode: 404 } });
    }
    return toOwnCreator(creator);
  });

  app.patch("/creators/me", { preHandler: [requireSession, requireCsrf] }, async (request, reply) => {
    const parsed = updateBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { message: parsed.error.issues[0]?.message ?? "Invalid input.", statusCode: 400 } });
    }

    const creator = await prisma.creator.findUnique({ where: { did: request.session!.did } });
    if (!creator) {
      return reply.status(404).send({ error: { message: "Not a creator yet.", statusCode: 404 } });
    }

    const hasProfileFields =
      parsed.data.displayName !== undefined || parsed.data.bio !== undefined || parsed.data.website !== undefined;

    try {
      const updated = await updateCreator(prisma, publishAtRecord, creator, {
        slug: parsed.data.slug,
        profile: hasProfileFields
          ? {
              displayName: parsed.data.displayName,
              bio: parsed.data.bio,
              website: normalizeWebsite(parsed.data.website),
            }
          : undefined,
      });
      return toOwnCreator(updated);
    } catch (error) {
      return sendCreatorError(error, reply);
    }
  });

  app.get("/creators/:identifier", async (request, reply) => {
    const { identifier } = request.params as { identifier: string };
    const creator = await findActiveCreatorByIdentifier(prisma, identifier);
    if (!creator) {
      return reply.status(404).send({ error: { message: "Creator not found.", statusCode: 404 } });
    }
    return toPublicCreator(creator);
  });
}
