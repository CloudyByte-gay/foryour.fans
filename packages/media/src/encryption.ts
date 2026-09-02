import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Content encryption for creator-owned GATED media/post bodies — see
 * prompts/creator-owned-pds.md "Required Privacy Design" and
 * docs/creator-owned-pds.md.
 *
 * ## Threat model (honest, and deliberately narrow)
 *
 * What this protects against:
 * - A third party who fetches a gated `fans.foryour.media` blob or a gated
 *   `fans.foryour.post.encryptedBody` from the creator's PDS (or off a
 *   firehose archive) WITHOUT a content key sees only AES-256-GCM
 *   ciphertext. `com.atproto.sync.getBlob` has no per-viewer auth, so this
 *   ciphertext-at-rest is the ONLY thing standing between "creator-owned +
 *   portable" and "world-readable".
 * - A cancelled/expired/past-due subscriber cannot obtain a NEW content key
 *   (enforced in packages/subscriptions/src/keyGrants.ts, not here).
 *
 * What this does NOT protect against, and the review must accept:
 * - foryour.fans CAN decrypt: content keys are generated server-side and
 *   envelope-wrapped with `CONTENT_KEY_WRAP_SECRET`. This is an interim
 *   trust placement (see docs/creator-owned-pds.md §10 Q3). A creator-held
 *   root key would remove it, at the cost of server-side search/moderation
 *   of gated content.
 * - Already-downloaded plaintext stays downloaded. Revocation stops future
 *   grants; it is not DRM.
 * - Metadata (record existence, size, timing, tier gate) is still public if
 *   a gated record is ever written to the open repo. This is the main
 *   reason gated content ships DEFERRED (flag-gated), not on by default.
 * - No forward secrecy. A leaked `CONTENT_KEY_WRAP_SECRET` plus archived
 *   ciphertext = full compromise of every gated post. Rotate by
 *   re-wrapping, and treat the secret like a signing key.
 *
 * Algorithm: AES-256-GCM, 12-byte random IV per operation, 16-byte auth tag
 * appended to the ciphertext. Key: 32 bytes.
 */

export const CONTENT_ENCRYPTION_ALGORITHM = "AES-256-GCM";

const IV_BYTES = 12;
const KEY_BYTES = 32;
const TAG_BYTES = 16;

export interface EncryptedPayload {
  algorithm: typeof CONTENT_ENCRYPTION_ALGORITHM;
  /** Base64 IV. */
  iv: string;
  /** Base64 ciphertext with the GCM auth tag appended. */
  ciphertext: string;
}

/** A fresh per-post / per-media content key. Never reuse one across records. */
export function generateContentKey(): Buffer {
  return randomBytes(KEY_BYTES);
}

export function encryptBytes(plaintext: Uint8Array, contentKey: Buffer): EncryptedPayload {
  assertKey(contentKey);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", contentKey, iv);
  const enc = Buffer.concat([cipher.update(Buffer.from(plaintext)), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    algorithm: CONTENT_ENCRYPTION_ALGORITHM,
    iv: iv.toString("base64"),
    ciphertext: Buffer.concat([enc, tag]).toString("base64"),
  };
}

export function decryptBytes(payload: EncryptedPayload, contentKey: Buffer): Buffer {
  assertKey(contentKey);
  const iv = Buffer.from(payload.iv, "base64");
  const blob = Buffer.from(payload.ciphertext, "base64");
  if (blob.length < TAG_BYTES) {
    throw new ContentDecryptionError("ciphertext too short to contain an auth tag");
  }
  const enc = blob.subarray(0, blob.length - TAG_BYTES);
  const tag = blob.subarray(blob.length - TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", contentKey, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(enc), decipher.final()]);
  } catch (error) {
    throw new ContentDecryptionError("authentication failed — wrong key or tampered ciphertext", error);
  }
}

export function encryptText(text: string, contentKey: Buffer): EncryptedPayload {
  return encryptBytes(new TextEncoder().encode(text), contentKey);
}

export function decryptText(payload: EncryptedPayload, contentKey: Buffer): string {
  return decryptBytes(payload, contentKey).toString("utf8");
}

/**
 * Envelope-wrap a content key with the server's long-lived wrap secret, for
 * at-rest storage in `ContentKey.wrappedKey`. The wrap secret is stretched
 * with SHA-256 so any-length config value maps to a 32-byte AES key.
 */
export function wrapContentKey(contentKey: Buffer, wrapSecret: string): string {
  assertKey(contentKey);
  const kek = deriveKek(wrapSecret);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", kek, iv);
  const enc = Buffer.concat([cipher.update(contentKey), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, enc, tag]).toString("base64");
}

export function unwrapContentKey(wrapped: string, wrapSecret: string): Buffer {
  const kek = deriveKek(wrapSecret);
  const blob = Buffer.from(wrapped, "base64");
  if (blob.length < IV_BYTES + TAG_BYTES) {
    throw new ContentDecryptionError("wrapped key blob too short");
  }
  const iv = blob.subarray(0, IV_BYTES);
  const tag = blob.subarray(blob.length - TAG_BYTES);
  const enc = blob.subarray(IV_BYTES, blob.length - TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", kek, iv);
  decipher.setAuthTag(tag);
  try {
    const key = Buffer.concat([decipher.update(enc), decipher.final()]);
    assertKey(key);
    return key;
  } catch (error) {
    if (error instanceof ContentDecryptionError) {
      throw error;
    }
    throw new ContentDecryptionError("failed to unwrap content key — wrong CONTENT_KEY_WRAP_SECRET?", error);
  }
}

export class ContentDecryptionError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ContentDecryptionError";
  }
}

function deriveKek(wrapSecret: string): Buffer {
  if (!wrapSecret || wrapSecret.length < 16) {
    throw new Error("CONTENT_KEY_WRAP_SECRET must be at least 16 characters");
  }
  return createHash("sha256").update(wrapSecret, "utf8").digest();
}

function assertKey(key: Buffer): void {
  if (key.length !== KEY_BYTES) {
    throw new Error(`content key must be ${KEY_BYTES} bytes, got ${key.length}`);
  }
}
