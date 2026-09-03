import { apiFetch } from "@/lib/apiFetch";
import { csrfHeaders } from "@/lib/csrf";

/**
 * Client-safe media helpers, mirrored from the API's media subsystem
 * (`apps/api/src/routes/media.ts`, `@foryour-fans/media`'s validation). The
 * MIME/size lists reject the same input the server would, *before* a
 * presigned URL is ever requested. The upload itself is a direct browser →
 * object-storage PUT (never proxied through our API); only `GET
 * /media/:id/access` is used to read bytes back, on demand, via a
 * short-lived signed URL.
 *
 * No `next/headers` / server-only imports — imported by client components.
 */

// --- Validation (mirror of packages/media/src/validation.ts) ----------------

export const ALLOWED_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
export const ALLOWED_VIDEO_MIME_TYPES = ["video/mp4", "video/webm", "video/quicktime"] as const;
export const ALLOWED_MIME_TYPES = [...ALLOWED_IMAGE_MIME_TYPES, ...ALLOWED_VIDEO_MIME_TYPES];
/** For the file-picker `accept` attribute. */
export const MEDIA_ACCEPT_ATTR = ALLOWED_MIME_TYPES.join(",");

export const MAX_IMAGE_SIZE_BYTES = 25 * 1024 * 1024;
export const MAX_VIDEO_SIZE_BYTES = 500 * 1024 * 1024;

/** Mirror of `@foryour-fans/content`'s `MAX_POST_MEDIA`. */
export const MAX_POST_MEDIA = 20;

export type MediaKind = "image" | "video";

export function mediaKind(mimeType: string): MediaKind | null {
  if ((ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(mimeType)) return "image";
  if ((ALLOWED_VIDEO_MIME_TYPES as readonly string[]).includes(mimeType)) return "video";
  return null;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

export type FileCheck = { ok: true; kind: MediaKind } | { ok: false; message: string };

/** Client-side gate run before requesting a presigned URL. */
export function checkFile(file: { type: string; size: number }): FileCheck {
  const kind = mediaKind(file.type);
  if (!kind) {
    return { ok: false, message: "Only JPEG, PNG, WebP, GIF, MP4, WebM and MOV files are supported." };
  }
  const max = kind === "video" ? MAX_VIDEO_SIZE_BYTES : MAX_IMAGE_SIZE_BYTES;
  if (file.size <= 0) {
    return { ok: false, message: "That file looks empty." };
  }
  if (file.size > max) {
    return { ok: false, message: `${kind === "video" ? "Videos" : "Images"} must be under ${formatBytes(max)}.` };
  }
  return { ok: true, kind };
}

// --- API shapes ------------------------------------------------------------

export type MediaAssetStatus = "PENDING_UPLOAD" | "PROCESSING" | "READY" | "REJECTED";

export interface MediaAsset {
  id: string;
  mimeType: string;
  size: number;
  width: number | null;
  height: number | null;
  duration: number | null;
  status: MediaAssetStatus;
  createdAt: string;
  updatedAt: string;
}

interface UploadIntent extends MediaAsset {
  uploadUrl: string;
  uploadUrlExpiresAt: string;
}

interface ApiError {
  error?: { message?: string; statusCode?: number };
}

async function readApiError(res: Response, fallback: string): Promise<string> {
  const body = (await res.json().catch(() => null)) as ApiError | null;
  return body?.error?.message ?? fallback;
}

/** `POST /media/upload-url` — reserves a `PENDING_UPLOAD` asset + a presigned PUT URL. */
export async function requestUploadUrl(fields: {
  mimeType: string;
  size: number;
  width?: number;
  height?: number;
  duration?: number;
}): Promise<{ ok: true; intent: UploadIntent } | { ok: false; message: string }> {
  let res: Response;
  try {
    res = await apiFetch("/media/upload-url", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...csrfHeaders() },
      body: JSON.stringify(fields),
    });
  } catch {
    return { ok: false, message: "We couldn't reach foryour.fans. Check your connection and try again." };
  }
  if (res.status === 201) {
    return { ok: true, intent: (await res.json()) as UploadIntent };
  }
  return { ok: false, message: await readApiError(res, "Couldn't start the upload.") };
}

/**
 * Direct browser → object-storage PUT of the file bytes. Uses
 * `XMLHttpRequest` (not `fetch`) purely for `upload.onprogress` — there is
 * no streaming upload-progress event in the fetch API. Resolves on a 2xx,
 * rejects otherwise; `onProgress` gets a 0–1 fraction.
 */
export function putBytes(
  uploadUrl: string,
  file: Blob,
  opts: { onProgress?: (fraction: number) => void; signal?: AbortSignal } = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && opts.onProgress) {
        opts.onProgress(event.loaded / event.total);
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`Upload failed (${xhr.status}).`));
      }
    };
    xhr.onerror = () => reject(new Error("Upload failed. Check your connection and try again."));
    xhr.onabort = () => reject(new DOMException("Upload aborted", "AbortError"));
    if (opts.signal) {
      opts.signal.addEventListener("abort", () => xhr.abort(), { once: true });
    }
    xhr.send(file);
  });
}

/** `POST /media/:id/complete` — moves the asset into PROCESSING then READY/REJECTED. */
export async function completeUpload(
  assetId: string,
): Promise<{ ok: true; asset: MediaAsset } | { ok: false; message: string }> {
  let res: Response;
  try {
    res = await apiFetch(`/media/${assetId}/complete`, { method: "POST", headers: { ...csrfHeaders() } });
  } catch {
    return { ok: false, message: "We couldn't reach foryour.fans. Check your connection and try again." };
  }
  if (res.ok) {
    return { ok: true, asset: (await res.json()) as MediaAsset };
  }
  return { ok: false, message: await readApiError(res, "Couldn't finish the upload.") };
}

/** `GET /media/:id` — owner-only status poll while an asset is PROCESSING. */
export async function getAssetStatus(
  assetId: string,
): Promise<{ ok: true; asset: MediaAsset } | { ok: false; message: string }> {
  let res: Response;
  try {
    res = await apiFetch(`/media/${assetId}`);
  } catch {
    return { ok: false, message: "We couldn't reach foryour.fans. Check your connection and try again." };
  }
  if (res.ok) {
    return { ok: true, asset: (await res.json()) as MediaAsset };
  }
  return { ok: false, message: await readApiError(res, "Couldn't check the file status.") };
}

export type MediaAccess =
  | { ok: true; url: string; expiresAt: string }
  | { ok: false; reason: "locked" | "missing" | "error" };

/**
 * `GET /media/:id/access` — a short-lived signed URL for the bytes. `locked`
 * (403) is the "subscribe to unlock" case; `missing` (404) means the asset
 * is gone or not READY. Callers refresh a URL once it nears `expiresAt`.
 */
export async function getMediaAccess(assetId: string): Promise<MediaAccess> {
  let res: Response;
  try {
    res = await apiFetch(`/media/${assetId}/access`);
  } catch {
    return { ok: false, reason: "error" };
  }
  if (res.ok) {
    const body = (await res.json()) as { url: string; expiresAt: string };
    return { ok: true, url: body.url, expiresAt: body.expiresAt };
  }
  if (res.status === 403) return { ok: false, reason: "locked" };
  if (res.status === 404) return { ok: false, reason: "missing" };
  return { ok: false, reason: "error" };
}

// --- Composer working state ---------------------------------------------------

/**
 * One row in the composer's attachment list. `localId` is a stable client
 * key across the upload lifecycle; `assetId` appears once the presigned URL
 * request succeeds. Only `ready` rows may be saved onto a post.
 */
export interface Attachment {
  localId: string;
  assetId: string | null;
  status: "validating" | "uploading" | "processing" | "ready" | "error";
  progress: number;
  kind: MediaKind;
  mimeType: string;
  name: string;
  size: number;
  /** Object URL for the local file, shown until the asset is READY. Revoke on removal. */
  previewUrl: string | null;
  width?: number;
  height?: number;
  durationSeconds?: number;
  error?: string;
}

/** The saved shape a post carries — the subset persisted via `POST/PATCH /creators/me/posts`. */
export interface PostMediaRef {
  mediaAssetId: string;
  sortOrder: number;
}

export function attachmentsToRefs(attachments: Attachment[]): PostMediaRef[] {
  return attachments
    .filter((a): a is Attachment & { assetId: string } => a.status === "ready" && a.assetId !== null)
    .map((a, index) => ({ mediaAssetId: a.assetId, sortOrder: index }));
}

export function allReady(attachments: Attachment[]): boolean {
  return attachments.every((a) => a.status === "ready");
}

/** Reads intrinsic dimensions / duration from a local file, best-effort (never rejects). */
export function probeDimensions(
  file: File,
  kind: MediaKind,
): Promise<{ width?: number; height?: number; durationSeconds?: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const done = (out: { width?: number; height?: number; durationSeconds?: number }) => {
      URL.revokeObjectURL(url);
      resolve(out);
    };
    if (kind === "image") {
      const img = new Image();
      img.onload = () => done({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => done({});
      img.src = url;
    } else {
      const video = document.createElement("video");
      video.preload = "metadata";
      video.onloadedmetadata = () =>
        done({
          width: video.videoWidth,
          height: video.videoHeight,
          durationSeconds: Number.isFinite(video.duration) ? Math.round(video.duration) : undefined,
        });
      video.onerror = () => done({});
      video.src = url;
    }
  });
}
