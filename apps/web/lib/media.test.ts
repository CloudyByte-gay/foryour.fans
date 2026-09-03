import { describe, expect, it } from "vitest";
import {
  MAX_IMAGE_SIZE_BYTES,
  MAX_VIDEO_SIZE_BYTES,
  allReady,
  attachmentsToRefs,
  checkFile,
  formatBytes,
  mediaKind,
  type Attachment,
} from "./media";

function att(partial: Partial<Attachment>): Attachment {
  return {
    localId: partial.localId ?? "a",
    assetId: partial.assetId ?? null,
    status: partial.status ?? "ready",
    progress: 1,
    kind: "image",
    mimeType: "image/png",
    name: "x.png",
    size: 1,
    previewUrl: null,
    ...partial,
  };
}

describe("checkFile", () => {
  it("accepts a normal image and reports its kind", () => {
    expect(checkFile({ type: "image/jpeg", size: 1024 })).toEqual({ ok: true, kind: "image" });
  });

  it("accepts a normal video", () => {
    expect(checkFile({ type: "video/mp4", size: 1024 })).toEqual({ ok: true, kind: "video" });
  });

  it("rejects an unsupported type", () => {
    const result = checkFile({ type: "application/pdf", size: 10 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/supported/i);
  });

  it("rejects an oversized image but allows the same size as a video", () => {
    const size = MAX_IMAGE_SIZE_BYTES + 1;
    expect(checkFile({ type: "image/png", size }).ok).toBe(false);
    expect(checkFile({ type: "video/mp4", size }).ok).toBe(true);
  });

  it("rejects an oversized video", () => {
    expect(checkFile({ type: "video/mp4", size: MAX_VIDEO_SIZE_BYTES + 1 }).ok).toBe(false);
  });

  it("rejects an empty file", () => {
    expect(checkFile({ type: "image/png", size: 0 }).ok).toBe(false);
  });
});

describe("mediaKind", () => {
  it("maps mime types to image/video, null otherwise", () => {
    expect(mediaKind("image/webp")).toBe("image");
    expect(mediaKind("video/quicktime")).toBe("video");
    expect(mediaKind("text/plain")).toBeNull();
  });
});

describe("attachmentsToRefs", () => {
  it("keeps only READY rows with an assetId and packs sortOrder densely", () => {
    const refs = attachmentsToRefs([
      att({ localId: "1", status: "ready", assetId: "aa" }),
      att({ localId: "2", status: "uploading", assetId: "bb" }),
      att({ localId: "3", status: "ready", assetId: "cc" }),
      att({ localId: "4", status: "ready", assetId: null }),
    ]);
    expect(refs).toEqual([
      { mediaAssetId: "aa", sortOrder: 0 },
      { mediaAssetId: "cc", sortOrder: 1 },
    ]);
  });
});

describe("allReady", () => {
  it("is true only when every attachment is ready (and vacuously for none)", () => {
    expect(allReady([])).toBe(true);
    expect(allReady([att({ status: "ready" })])).toBe(true);
    expect(allReady([att({ status: "ready" }), att({ status: "processing" })])).toBe(false);
  });
});

describe("formatBytes", () => {
  it("renders human sizes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(25 * 1024 * 1024)).toBe("25 MB");
  });
});
