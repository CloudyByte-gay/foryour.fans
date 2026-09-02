import type { MediaProcessor, ObjectStorage } from "./types.js";

/**
 * In-memory ObjectStorage double for tests — records every call for
 * assertions and never makes a real network call, unlike S3ObjectStorage.
 * Fake URLs are deterministic (derived from the key) so a test can assert
 * on them without needing real presigned-URL parsing.
 *
 * Unlike FakePaymentProvider (Phase 6), this one is genuinely test-only —
 * S3ObjectStorage is the real, shipped implementation (wired against a
 * real MinIO in server.ts), not a stand-in for a business decision that
 * hasn't been made yet. It's exported from this package rather than
 * redefined per apps/api test file purely to avoid duplicating one
 * uniform, always-succeeds double across many call sites — see
 * apps/api/test/fakes.ts.
 */
export class FakeObjectStorage implements ObjectStorage {
  readonly uploadCalls: Array<{ key: string; contentType: string }> = [];
  readonly downloadCalls: Array<{ key: string }> = [];
  readonly deleteCalls: Array<{ key: string }> = [];

  createUploadUrl(params: { key: string; contentType: string }): Promise<{ uploadUrl: string; expiresAt: Date }> {
    this.uploadCalls.push(params);
    return Promise.resolve({ uploadUrl: `https://fake-storage.test/upload/${params.key}`, expiresAt: new Date(Date.now() + 60_000) });
  }

  createDownloadUrl(params: { key: string }): Promise<{ downloadUrl: string; expiresAt: Date }> {
    this.downloadCalls.push(params);
    return Promise.resolve({ downloadUrl: `https://fake-storage.test/download/${params.key}`, expiresAt: new Date(Date.now() + 60_000) });
  }

  deleteObject(params: { key: string }): Promise<void> {
    this.deleteCalls.push(params);
    return Promise.resolve();
  }
}

/** Always resolves "ready" or always "rejected" — for tests that need to force a REJECTED asset without a real scanner. */
export function fixedResultMediaProcessor(result: "ready" | "rejected"): MediaProcessor {
  return { process: () => Promise.resolve(result) };
}
