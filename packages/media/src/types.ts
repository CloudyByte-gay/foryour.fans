import type { MediaAssetStatus } from "@foryour-fans/database";

export type { MediaAssetStatus };

/**
 * Storage-only, S3-compatible object storage abstraction — see
 * prompts/full.md PHASE 8 ("use private S3-compatible storage") and
 * docs/architecture.md. The real implementation (S3ObjectStorage,
 * src/s3Storage.ts) is built against `@aws-sdk/client-s3`, which speaks the
 * S3 API itself rather than any single vendor's SDK — so the same class
 * works against MinIO (local dev, wired in server.ts today), and is
 * expected to work against Cloudflare R2 or Google Cloud Storage's
 * S3-compatible XML API in production by changing only `endpoint`/
 * `region`/credentials, never application code. This interface has no
 * entitlement awareness at all — same discipline Phase 7 established for
 * ContentRepository: storage is storage, "who's allowed to read this" is
 * decided by the caller (apps/api/src/routes/media.ts), not this layer.
 */
export interface ObjectStorage {
  /** A short-lived URL the browser PUTs the object's bytes to directly — never proxied through our API. */
  createUploadUrl(params: { key: string; contentType: string }): Promise<{ uploadUrl: string; expiresAt: Date }>;
  /** A short-lived URL the browser GETs the object's bytes from directly. Never issued for a non-`READY` asset — see routes/media.ts. */
  createDownloadUrl(params: { key: string }): Promise<{ downloadUrl: string; expiresAt: Date }>;
  deleteObject(params: { key: string }): Promise<void>;
}

/**
 * The hook Phase 14 (and any future transcoding/thumbnailing work) plugs
 * into without a schema change — see prompts/full.md PHASE 8: "design the
 * media processing interface to support future: transcoding, thumbnails,
 * virus scanning, moderation scanning. Do not build full transcoding
 * infrastructure unless necessary yet." `PassthroughMediaProcessor`
 * (src/processor.ts) is the only implementation this phase ships: it does
 * none of that, and always resolves "ready". It is still the REAL,
 * shipped implementation (not a test-only fake) — matching Phase 6's
 * FakePaymentProvider precedent of "the honest thing to ship when the real
 * capability doesn't exist yet is a working no-op, not a mock."
 */
export interface MediaProcessor {
  process(asset: { id: string; storageKey: string; mimeType: string }): Promise<"ready" | "rejected">;
}
