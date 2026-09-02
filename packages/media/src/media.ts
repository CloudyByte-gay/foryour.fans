import { randomUUID } from "node:crypto";
import type { Creator, MediaAsset, PrismaClient } from "@foryour-fans/database";
import { extensionForMimeType, validateUploadRequest } from "./validation.js";
import type { MediaProcessor, ObjectStorage } from "./types.js";

export class MediaAssetNotFoundError extends Error {}
export class MediaAssetStateError extends Error {}

export interface UploadIntentFields {
  mimeType: string;
  size: number;
  width?: number;
  height?: number;
  duration?: number;
}

/** `storageKey` is namespaced by creator so a listing/cleanup of one creator's objects never needs to scan the whole bucket. */
function storageKeyFor(creatorId: string, mimeType: string): string {
  return `media/${creatorId}/${randomUUID()}.${extensionForMimeType(mimeType)}`;
}

/**
 * Reserves a storage key and creates the PENDING_UPLOAD row BEFORE asking
 * storage for a presigned URL — so the URL and the DB row always agree on
 * where the bytes are meant to land, and a request that fails partway
 * through (e.g. storage is unreachable) never leaves an orphaned DB row
 * with no corresponding presigned URL ever issued. If `storage` throws,
 * nothing has been returned to the caller yet, but the row does exist —
 * see completeUpload's ownership+status checks for why a caller retrying
 * `POST /media/upload-url` again is fine (it just creates a second,
 * independent PENDING_UPLOAD row; nothing ever auto-expires or garbage-
 * collects an abandoned one in this phase, a known limitation).
 */
export async function createUploadIntent(
  prisma: PrismaClient,
  storage: ObjectStorage,
  creator: Creator,
  fields: UploadIntentFields,
): Promise<{ asset: MediaAsset; uploadUrl: string; expiresAt: Date }> {
  validateUploadRequest(fields);

  const storageKey = storageKeyFor(creator.id, fields.mimeType);

  const asset = await prisma.mediaAsset.create({
    data: {
      creatorId: creator.id,
      storageKey,
      mimeType: fields.mimeType,
      size: fields.size,
      width: fields.width,
      height: fields.height,
      duration: fields.duration,
    },
  });

  const { uploadUrl, expiresAt } = await storage.createUploadUrl({ key: storageKey, contentType: fields.mimeType });
  return { asset, uploadUrl, expiresAt };
}

export async function getOwnedMediaAsset(prisma: PrismaClient, creatorId: string, assetId: string): Promise<MediaAsset> {
  const asset = await prisma.mediaAsset.findUnique({ where: { id: assetId } });
  if (!asset || asset.creatorId !== creatorId) {
    throw new MediaAssetNotFoundError("Media asset not found.");
  }
  return asset;
}

/**
 * PENDING_UPLOAD -> PROCESSING -> READY/REJECTED, called once the browser
 * has finished PUTting bytes to the presigned URL. There is no way for the
 * API to independently verify the PUT actually happened (that's between
 * the browser and object storage) — `processor.process` is the trust
 * boundary; a real virus/moderation scanner (Phase 14) would naturally
 * fail closed (REJECTED) on a missing/corrupt object when it tries to read
 * it, which `PassthroughMediaProcessor` obviously can't do since it never
 * looks at the bytes at all. Calling this twice on the same asset throws
 * MediaAssetStateError rather than silently reprocessing — an asset only
 * transitions out of PENDING_UPLOAD once.
 */
export async function completeUpload(
  prisma: PrismaClient,
  processor: MediaProcessor,
  creatorId: string,
  assetId: string,
): Promise<MediaAsset> {
  const asset = await getOwnedMediaAsset(prisma, creatorId, assetId);
  if (asset.status !== "PENDING_UPLOAD") {
    throw new MediaAssetStateError(`Media asset is already ${asset.status}, not PENDING_UPLOAD.`);
  }

  await prisma.mediaAsset.update({ where: { id: asset.id }, data: { status: "PROCESSING" } });

  const result = await processor.process({ id: asset.id, storageKey: asset.storageKey, mimeType: asset.mimeType });

  return prisma.mediaAsset.update({
    where: { id: asset.id },
    data: { status: result === "ready" ? "READY" : "REJECTED" },
  });
}

/** Returns null (never the row) for a missing OR non-READY asset — the one call site (routes/media.ts) must never distinguish "doesn't exist" from "not ready" to a caller, since both mean "no signed URL for you." */
export async function getReadyMediaAsset(prisma: PrismaClient, assetId: string): Promise<MediaAsset | null> {
  const asset = await prisma.mediaAsset.findUnique({ where: { id: assetId } });
  return asset && asset.status === "READY" ? asset : null;
}
