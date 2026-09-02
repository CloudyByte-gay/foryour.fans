import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { ObjectStorage } from "./types.js";

const UPLOAD_URL_TTL_SECONDS = 5 * 60; // 5 minutes — long enough for a real upload, short enough that a leaked URL is useless soon after.
const DOWNLOAD_URL_TTL_SECONDS = 60; // Short-lived per prompts/full.md PHASE 8's read-flow diagram — a fresh GET /media/:id/access call re-checks entitlement every time.

export interface S3ObjectStorageConfig {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /**
   * MinIO and most non-AWS S3-compatible providers require path-style
   * addressing (`endpoint/bucket/key`) rather than AWS's default
   * virtual-hosted style (`bucket.endpoint/key`) — Cloudflare R2 and GCS's
   * S3-compatible endpoint both work with this too, so `true` is the safe
   * default across every provider this app is likely to run against.
   */
  forcePathStyle: boolean;
}

/**
 * The real (only) Phase 8 ObjectStorage implementation — see types.ts's
 * doc comment on why one class covers MinIO/R2/GCS. Never proxies bytes
 * through our own API: both upload and download are presigned URLs the
 * browser talks to storage with directly, so `apps/api` never holds a
 * subscriber's media payload in memory or bandwidth.
 */
export class S3ObjectStorage implements ObjectStorage {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: S3ObjectStorageConfig) {
    this.bucket = config.bucket;
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      forcePathStyle: config.forcePathStyle,
    });
  }

  async createUploadUrl({ key, contentType }: { key: string; contentType: string }): Promise<{ uploadUrl: string; expiresAt: Date }> {
    const command = new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType });
    const uploadUrl = await getSignedUrl(this.client, command, { expiresIn: UPLOAD_URL_TTL_SECONDS });
    return { uploadUrl, expiresAt: new Date(Date.now() + UPLOAD_URL_TTL_SECONDS * 1000) };
  }

  async createDownloadUrl({ key }: { key: string }): Promise<{ downloadUrl: string; expiresAt: Date }> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    const downloadUrl = await getSignedUrl(this.client, command, { expiresIn: DOWNLOAD_URL_TTL_SECONDS });
    return { downloadUrl, expiresAt: new Date(Date.now() + DOWNLOAD_URL_TTL_SECONDS * 1000) };
  }

  async deleteObject({ key }: { key: string }): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
