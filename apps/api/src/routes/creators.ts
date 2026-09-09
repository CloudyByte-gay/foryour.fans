import type { Creator, PrismaClient, User } from "@foryour-fans/database";
import { CREATOR_OWNED_COLLECTIONS } from "@foryour-fans/content";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { requireCsrf, requireSession } from "../plugins/session.js";
import { AtRecordPublishError, type PublishAtRecord } from "@foryour-fans/atproto";
import {
  AlreadyACreatorError,
  createCreator,
  resolveCreatorByIdentifier,
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

const siteImageFieldsSchema = {
  avatarUrl: z.string().trim().url().max(2048).nullable().optional(),
  bannerUrl: z.string().trim().url().max(2048).nullable().optional(),
};

// Every field is optional — an empty body is a valid "become a creator"
// request. There is no app-owned name to pick.
const createBodySchema = z.object({ ...profileFieldsSchema, ...siteImageFieldsSchema });

const updateBodySchema = z.object({ ...profileFieldsSchema, ...siteImageFieldsSchema });

/** `handle` is the public identity, keyed by the durable `did`. */
function toPublicCreator(creator: Creator, user: Pick<User, "handle" | "avatarUrl" | "bannerUrl">) {
  return {
    // Phase 14 — the internal Creator id, needed as `Report.subjectId` when
    // reporting a creator (POST /reports). Not otherwise sensitive: an
    // opaque uuid, same exposure level as Post.id/Comment.id/tier.id, all
    // already public.
    id: creator.id,
    did: creator.did,
    handle: user.handle,
    displayName: creator.displayName,
    bio: creator.bio,
    website: creator.website,
    avatarUrl: creator.avatarUrl ?? user.avatarUrl,
    bannerUrl: creator.bannerUrl ?? user.bannerUrl,
    createdAt: creator.createdAt,
  };
}

function toOwnCreator(creator: Creator, user: Pick<User, "handle" | "avatarUrl" | "bannerUrl">) {
  return {
    did: creator.did,
    handle: user.handle,
    displayName: creator.displayName,
    bio: creator.bio,
    website: creator.website,
    avatarUrl: creator.avatarUrl ?? user.avatarUrl,
    bannerUrl: creator.bannerUrl ?? user.bannerUrl,
    siteAvatarUrl: creator.avatarUrl,
    siteBannerUrl: creator.bannerUrl,
    status: creator.status,
    verificationStatus: creator.verificationStatus,
    createdAt: creator.createdAt,
    updatedAt: creator.updatedAt,
  };
}

/** Empty-string website from the form means "clear it" (null) — omitted means "leave it" (undefined). */
function normalizeWebsite(website: string | undefined): string | null | undefined {
  if (website === undefined) return undefined;
  return website === "" ? null : website;
}

/** Maps the creators-service's typed errors to HTTP responses. Rethrows anything it doesn't recognize, letting the global error handler take it (see plugins/error-handler.ts). */
function sendCreatorError(error: unknown, reply: FastifyReply): FastifyReply {
  if (error instanceof AlreadyACreatorError) {
    return reply.status(409).send({ error: { message: error.message, statusCode: 409 } });
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
        profile: {
          displayName: parsed.data.displayName,
          bio: parsed.data.bio,
          website: normalizeWebsite(parsed.data.website),
        },
        siteImages: {
          avatarUrl: parsed.data.avatarUrl,
          bannerUrl: parsed.data.bannerUrl,
        },
      });
      return reply.status(201).send(toOwnCreator(creator, user));
    } catch (error) {
      return sendCreatorError(error, reply);
    }
  });

  app.get("/creators/me", { preHandler: [requireSession] }, async (request, reply) => {
    const creator = await prisma.creator.findUnique({
      where: { did: request.session!.did },
      include: { user: true },
    });
    if (!creator) {
      return reply.status(404).send({ error: { message: "Not a creator yet.", statusCode: 404 } });
    }
    return toOwnCreator(creator, creator.user);
  });

  // Creator-owned-PDS portability / sync-status panel
  // (prompts/creator-owned-pds.md "Web Refactor"). Honest about what is and
  // isn't creator-owned yet — `fullyPortable` is false while any tier or
  // post is still app-authoritative (e.g. gated content deferred behind the
  // documented protocol gap).
  app.get("/creators/me/portability", { preHandler: [requireSession] }, async (request, reply) => {
    const creator = await prisma.creator.findUnique({
      where: { did: request.session!.did },
      include: { user: true },
    });
    if (!creator) {
      return reply.status(404).send({ error: { message: "Not a creator yet.", statusCode: 404 } });
    }

    const [appAuthoritativePosts, appAuthoritativeTiers, pdsOwnedPosts, gatedDeferredPosts] = await Promise.all([
      prisma.post.count({ where: { creatorId: creator.id, deletedAt: null, isAuthoritative: true } }),
      prisma.subscriptionTier.count({ where: { creatorId: creator.id, isActive: true, isAuthoritative: true } }),
      prisma.post.count({ where: { creatorId: creator.id, deletedAt: null, isAuthoritative: false } }),
      prisma.post.count({
        where: {
          creatorId: creator.id,
          deletedAt: null,
          isAuthoritative: true,
          visibility: { in: ["SUBSCRIBERS", "TIER"] },
        },
      }),
    ]);

    return {
      did: creator.did,
      handle: creator.user.handle,
      pdsUrl: creator.pdsUrl,
      recordCollections: [...CREATOR_OWNED_COLLECTIONS],
      profileSourceUri: creator.profileSourceUri,
      serviceConfigUri: creator.serviceConfigUri,
      lastSyncedAt: creator.pdsSyncedAt,
      counts: { pdsOwnedPosts, appAuthoritativePosts, gatedDeferredPosts },
      // A creator who controls their DID/PDS needs no export/import to move
      // to a compatible service — the records already live in their repo.
      exportImportNeededToMove: false,
      fullyPortable: appAuthoritativePosts === 0 && appAuthoritativeTiers === 0,
    };
  });

  app.patch("/creators/me", { preHandler: [requireSession, requireCsrf] }, async (request, reply) => {
    const parsed = updateBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { message: parsed.error.issues[0]?.message ?? "Invalid input.", statusCode: 400 } });
    }

    const creator = await prisma.creator.findUnique({
      where: { did: request.session!.did },
      include: { user: true },
    });
    if (!creator) {
      return reply.status(404).send({ error: { message: "Not a creator yet.", statusCode: 404 } });
    }

    const hasProfileFields =
      parsed.data.displayName !== undefined || parsed.data.bio !== undefined || parsed.data.website !== undefined;
    const hasSiteImageFields = parsed.data.avatarUrl !== undefined || parsed.data.bannerUrl !== undefined;

    try {
      const profileUpdated = await updateCreator(prisma, publishAtRecord, creator, {
        profile: hasProfileFields
          ? {
              displayName: parsed.data.displayName,
              bio: parsed.data.bio,
              website: normalizeWebsite(parsed.data.website),
            }
          : undefined,
      });
      const updated = hasSiteImageFields
        ? await prisma.creator.update({
            where: { id: profileUpdated.id },
            data: {
              ...(parsed.data.avatarUrl !== undefined ? { avatarUrl: parsed.data.avatarUrl } : {}),
              ...(parsed.data.bannerUrl !== undefined ? { bannerUrl: parsed.data.bannerUrl } : {}),
            },
          })
        : profileUpdated;
      return toOwnCreator(updated, creator.user);
    } catch (error) {
      return sendCreatorError(error, reply);
    }
  });

  app.get("/creators/:identifier", async (request, reply) => {
    const { identifier } = request.params as { identifier: string };
    const resolution = await resolveCreatorByIdentifier(prisma, identifier);

    if (resolution.status === "not-found") {
      return reply.status(404).send({ error: { message: "Creator not found.", statusCode: 404 } });
    }

    if (resolution.status === "moved") {
      // 301 + a JSON body so non-redirect-following clients (the web SSR
      // layer) can act on it without parsing the Location header.
      return reply
        .status(301)
        .header("location", `/creators/${resolution.currentHandle}`)
        .send({ movedTo: resolution.currentHandle, did: resolution.did });
    }

    return toPublicCreator(resolution.creator, resolution.creator.user);
  });
}
