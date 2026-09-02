import { describe, expect, it } from "vitest";
import { MAX_IMAGE_SIZE_BYTES, MAX_VIDEO_SIZE_BYTES, MediaValidationError, extensionForMimeType, validateUploadRequest } from "./validation.js";

describe("validateUploadRequest", () => {
  it("accepts a valid image", () => {
    expect(() => validateUploadRequest({ mimeType: "image/jpeg", size: 1024 })).not.toThrow();
  });

  it("accepts a valid video", () => {
    expect(() => validateUploadRequest({ mimeType: "video/mp4", size: 1024 * 1024 })).not.toThrow();
  });

  it("rejects an unsupported mimeType", () => {
    expect(() => validateUploadRequest({ mimeType: "application/pdf", size: 1024 })).toThrow(MediaValidationError);
  });

  it("rejects an SVG (a common upload-smuggling vector)", () => {
    expect(() => validateUploadRequest({ mimeType: "image/svg+xml", size: 1024 })).toThrow(MediaValidationError);
  });

  it("rejects a zero size", () => {
    expect(() => validateUploadRequest({ mimeType: "image/png", size: 0 })).toThrow(MediaValidationError);
  });

  it("rejects a negative size", () => {
    expect(() => validateUploadRequest({ mimeType: "image/png", size: -1 })).toThrow(MediaValidationError);
  });

  it("rejects a non-integer size", () => {
    expect(() => validateUploadRequest({ mimeType: "image/png", size: 10.5 })).toThrow(MediaValidationError);
  });

  it("rejects an image over the image size cap", () => {
    expect(() => validateUploadRequest({ mimeType: "image/png", size: MAX_IMAGE_SIZE_BYTES + 1 })).toThrow(MediaValidationError);
  });

  it("accepts an image exactly at the image size cap", () => {
    expect(() => validateUploadRequest({ mimeType: "image/png", size: MAX_IMAGE_SIZE_BYTES })).not.toThrow();
  });

  it("rejects a video over the video size cap", () => {
    expect(() => validateUploadRequest({ mimeType: "video/mp4", size: MAX_VIDEO_SIZE_BYTES + 1 })).toThrow(MediaValidationError);
  });

  it("accepts a video well under the image size cap but over what an image would allow, since caps are type-specific", () => {
    expect(() => validateUploadRequest({ mimeType: "video/mp4", size: MAX_IMAGE_SIZE_BYTES + 1 })).not.toThrow();
  });
});

describe("extensionForMimeType", () => {
  it("maps known mime types to their extension", () => {
    expect(extensionForMimeType("image/jpeg")).toBe("jpg");
    expect(extensionForMimeType("video/quicktime")).toBe("mov");
  });

  it("falls back to a generic extension for an unknown mimeType", () => {
    expect(extensionForMimeType("application/octet-stream")).toBe("bin");
  });
});
