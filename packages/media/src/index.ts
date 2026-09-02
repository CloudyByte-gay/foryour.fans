export type { MediaAssetStatus, MediaProcessor, ObjectStorage } from "./types.js";
export {
  ALLOWED_IMAGE_MIME_TYPES,
  ALLOWED_VIDEO_MIME_TYPES,
  MAX_IMAGE_SIZE_BYTES,
  MAX_VIDEO_SIZE_BYTES,
  MediaValidationError,
  extensionForMimeType,
  validateUploadRequest,
} from "./validation.js";
export type { UploadRequestFields } from "./validation.js";
export { S3ObjectStorage } from "./s3Storage.js";
export type { S3ObjectStorageConfig } from "./s3Storage.js";
export { PassthroughMediaProcessor } from "./processor.js";
export { FakeObjectStorage, fixedResultMediaProcessor } from "./fakes.js";
export {
  MediaAssetNotFoundError,
  MediaAssetStateError,
  completeUpload,
  createUploadIntent,
  getOwnedMediaAsset,
  getReadyMediaAsset,
} from "./media.js";
export type { UploadIntentFields } from "./media.js";
export {
  CONTENT_ENCRYPTION_ALGORITHM,
  ContentDecryptionError,
  decryptBytes,
  decryptText,
  encryptBytes,
  encryptText,
  generateContentKey,
  unwrapContentKey,
  wrapContentKey,
} from "./encryption.js";
export type { EncryptedPayload } from "./encryption.js";
