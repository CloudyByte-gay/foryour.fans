import type { MediaAsset, PrismaClient } from "@foryour-fans/database";
import {
  MediaAssetNotFoundError,
  MediaAssetStateError,
  MediaValidationError,
  completeUpload,
  createUploadIntent,
  getReadyMediaAsset,
  type MediaProcessor,
  type ObjectStorage,
} from "@foryour-fans/media";
import { canAccess } from "@foryour-fans/subscriptions";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { requireCsrf, requireSession } from "../plugins/session.js";

export interface MediaRoutesOptions {
  prisma: PrismaClient;
  objectStorage: ObjectStorage;
  mediaProcessor: MediaProcessor;
}

const uploadIntentSchema = z.object({
  mimeType: z.string().min(1),
  size: z.number().int().positive(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  duration: z.number().int().positive().optional(),
});

function toAssetResponse(asset: MediaAsset) {
  return {
    id: asset.id,
    mimeType: asset.mimeType,
    size: asset.size,
    width: asset.width,
    height: asset.height,
    duration: asset.duration,
    status: asset.status,
    createdAt: asset.createdAt,
    updatedAt: asset.updatedAt,
  };
}

function sendMediaError(error: unknown, reply: FastifyReply): FastifyReply {
  if (error instanceof MediaValidationError) {
    return reply.status(400).send({ error: { message: error.message, statusCode: 400 } });
  }
  if (error instanceof MediaAssetNotFoundError) {
    return reply.status(404).send({ error: { message: error.message, statusCode: 404 } });
  }
  if (error instanceof MediaAssetStateError) {
    return reply.status(409).send({ error: { message: error.message, statusCode: 409 } });
  }
  throw error;
}

/**
 * Routes for the Phase 8 private media subsystem — see docs/architecture.md
 * and packages/media. `objectStorage`/`mediaProcessor` are injected exactly
 * like `contentRepository`/`paymentProvider` before them: this file only
 * ever talks to the ObjectStorage/MediaProcessor interfaces, never to a
 * concrete storage SDK or a real scanner directly.
 */
export async function mediaRoutes(
  app: FastifyInstance,
  { prisma, objectStorage, mediaProcessor }: MediaRoutesOptions,
): Promise<void> {
  app.post("/media/upload-url", { preHandler: [requireSession, requireCsrf] }, async (request, reply) => {
    const parsed = uploadIntentSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: { message: parsed.error.issues[0]?.message ?? "Invalid input.", statusCode: 400 } });
    }

    const creator = await prisma.creator.findUnique({ where: { did: request.session!.did } });
    if (!creator) {
      return reply.status(404).send({ error: { message: "Not a creator yet.", statusCode: 404 } });
    }

    try {
      const { asset, uploadUrl, expiresAt } = await createUploadIntent(prisma, objectStorage, creator, parsed.data);
      return reply.status(201).send({ ...toAssetResponse(asset), uploadUrl, uploadUrlExpiresAt: expiresAt });
    } catch (error) {
      return sendMediaError(error, reply);
    }
  });

  app.post("/media/:id/complete", { preHandler: [requireSession, requireCsrf] }, async (request, reply) => {
    const creator = await prisma.creator.findUnique({ where: { did: request.session!.did } });
    if (!creator) {
      return reply.status(404).send({ error: { message: "Not a creator yet.", statusCode: 404 } });
    }

    const { id } = request.params as { id: string };
    try {
      const asset = await completeUpload(prisma, mediaProcessor, creator.id, id);
      return toAssetResponse(asset);
    } catch (error) {
      return sendMediaError(error, reply);
    }
  });

  /**
   * The entitlement gate matches checkPostAccess's shape in routes/posts.ts
   * (same "storage-only package, entitlement decided here" discipline from
   * Phase 7) but with a narrower rule, since Phase 8 doesn't attach a
   * MediaAsset to any specific Post yet (see PostMedia's doc comment in
   * schema.prisma): the asset's own creator always has access, and any
   * OTHER viewer needs an active subscription to that creator at ANY tier
   * — i.e. exactly `canAccess` with no `requiredTierId`, the same default
   * a SUBSCRIBERS-visibility post uses. This is an inferred design
   * decision, not something Phase 8's spec text states explicitly — see
   * docs/architecture.md.
   */
  app.get("/media/:id/access", async (request, reply) => {
    const { id } = request.params as { id: string };
    const asset = await getReadyMediaAsset(prisma, id);
    if (!asset) {
      return reply.status(404).send({ error: { message: "Media asset not found.", statusCode: 404 } });
    }

    const creator = await prisma.creator.findUnique({ where: { id: asset.creatorId } });
    if (!creator || creator.status !== "ACTIVE") {
      return reply.status(404).send({ error: { message: "Media asset not found.", statusCode: 404 } });
    }

    const viewerDid = request.session?.did ?? null;
    const allowed = viewerDid ? await canAccess(prisma, { subscriberDid: viewerDid, creatorDid: creator.did }) : false;
    if (!allowed) {
      return reply.status(403).send({ error: { message: "You don't have access to this media asset.", statusCode: 403 } });
    }

    const { downloadUrl, expiresAt } = await objectStorage.createDownloadUrl({ key: asset.storageKey });
    return { url: downloadUrl, expiresAt };
  });
}
