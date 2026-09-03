import type { Creator, MediaAsset, PrismaClient } from "@foryour-fans/database";
import type { ContentRepository } from "@foryour-fans/content";
import {
  MediaAssetNotFoundError,
  MediaAssetStateError,
  MediaValidationError,
  completeUpload,
  createUploadIntent,
  getOwnedMediaAsset,
  getReadyMediaAsset,
  type MediaProcessor,
  type ObjectStorage,
} from "@foryour-fans/media";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { requireCsrf, requireSession } from "../plugins/session.js";
import { checkPostAccess } from "./posts.js";

export interface MediaRoutesOptions {
  prisma: PrismaClient;
  objectStorage: ObjectStorage;
  mediaProcessor: MediaProcessor;
  contentRepository: ContentRepository;
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
  { prisma, objectStorage, mediaProcessor, contentRepository }: MediaRoutesOptions,
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
   * The creator polls this after `POST /media/:id/complete` until `status`
   * is `READY` or `REJECTED` — the composer blocks publishing while any
   * attachment is still `PROCESSING` (prompts/web.md WEB PHASE 8). Owner-only:
   * a non-owner has no business knowing an asset's processing state.
   * `PassthroughMediaProcessor` resolves synchronously so today `complete`
   * already returns the terminal status, but a real scanner (Phase 14) is
   * async — the poll route is the seam that keeps working when it lands.
   */
  app.get("/media/:id", { preHandler: [requireSession] }, async (request, reply) => {
    const creator = await prisma.creator.findUnique({ where: { did: request.session!.did } });
    if (!creator) {
      return reply.status(404).send({ error: { message: "Not a creator yet.", statusCode: 404 } });
    }
    const { id } = request.params as { id: string };
    try {
      const asset = await getOwnedMediaAsset(prisma, creator.id, id);
      return toAssetResponse(asset);
    } catch (error) {
      return sendMediaError(error, reply);
    }
  });

  /**
   * A media download grant is never broader than the content object that
   * exposes the media (prompts/security-hardening.md §3, pulled forward by
   * WEB PHASE 8 now that `PostMedia` has a writer). The rule:
   *
   * - the asset's own creator can always fetch their own `READY` asset;
   * - otherwise, if the asset is attached to one or more posts, the viewer
   *   must be able to read at least one of those posts under the SAME
   *   entitlement logic as `GET /posts/:id` (`checkPostAccess`) — so a
   *   TIER-gated post's media is only visible to a sufficient-tier
   *   subscriber, and a PUBLIC post's media is visible to anyone;
   * - if the asset is attached to nothing, only the creator can fetch it
   *   (unattached private media must not leak to subscribers);
   * - a non-`READY` asset (`PENDING_UPLOAD`/`PROCESSING`/`REJECTED`) never
   *   yields a signed URL, even to the creator — enforced by
   *   `getReadyMediaAsset` returning null.
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
    const allowed = viewerDid === creator.did || (await viewerCanAccessAttachedPost(id, creator, viewerDid));
    if (!allowed) {
      return reply.status(403).send({ error: { message: "You don't have access to this media asset.", statusCode: 403 } });
    }

    const { downloadUrl, expiresAt } = await objectStorage.createDownloadUrl({ key: asset.storageKey });
    return { url: downloadUrl, expiresAt };
  });

  async function viewerCanAccessAttachedPost(
    mediaAssetId: string,
    creator: Creator,
    viewerDid: string | null,
  ): Promise<boolean> {
    const links = await prisma.postMedia.findMany({ where: { mediaAssetId }, select: { postId: true } });
    if (links.length === 0) {
      return false; // Unattached: creator-only, and the creator was already allowed above.
    }
    for (const { postId } of links) {
      const post = await contentRepository.getPost(postId);
      if (post && post.creatorId === creator.id && (await checkPostAccess(prisma, post, creator, viewerDid))) {
        return true;
      }
    }
    return false;
  }
}
