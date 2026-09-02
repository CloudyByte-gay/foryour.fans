export class MediaValidationError extends Error {}

/**
 * Deliberately conservative starter lists for a creator-content platform —
 * broad enough to cover normal photo/video posts, narrow enough that
 * nothing exotic (SVG, executables disguised as media, etc.) sneaks
 * through. Extending these is a config change, not an architecture one.
 */
export const ALLOWED_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
export const ALLOWED_VIDEO_MIME_TYPES = new Set(["video/mp4", "video/webm", "video/quicktime"]);

export const MAX_IMAGE_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB
/**
 * A generous cap given Phase 8 explicitly does not build transcoding —
 * whatever a creator uploads is what gets served, so it has to already be
 * a reasonably-sized web-playable file. Revisit once real transcoding
 * exists and re-encoding to a bounded output size is possible.
 */
export const MAX_VIDEO_SIZE_BYTES = 500 * 1024 * 1024; // 500 MB

export interface UploadRequestFields {
  mimeType: string;
  size: number;
}

function isVideo(mimeType: string): boolean {
  return ALLOWED_VIDEO_MIME_TYPES.has(mimeType);
}

export function validateUploadRequest(fields: UploadRequestFields): void {
  const isImage = ALLOWED_IMAGE_MIME_TYPES.has(fields.mimeType);
  const isVid = isVideo(fields.mimeType);
  if (!isImage && !isVid) {
    throw new MediaValidationError(`Unsupported mimeType "${fields.mimeType}".`);
  }
  if (!Number.isInteger(fields.size) || fields.size <= 0) {
    throw new MediaValidationError("size must be a positive integer (bytes).");
  }
  const max = isVid ? MAX_VIDEO_SIZE_BYTES : MAX_IMAGE_SIZE_BYTES;
  if (fields.size > max) {
    throw new MediaValidationError(`size exceeds the maximum of ${max} bytes for mimeType "${fields.mimeType}".`);
  }
}

const EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
};

/** Only ever called after validateUploadRequest has already accepted the mimeType, so the lookup can't miss. */
export function extensionForMimeType(mimeType: string): string {
  return EXTENSION_BY_MIME_TYPE[mimeType] ?? "bin";
}
