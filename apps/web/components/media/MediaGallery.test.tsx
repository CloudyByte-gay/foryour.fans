import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MediaGallery, type PostMediaItem } from "./MediaGallery";
import { toGalleryItems } from "@/lib/mediaItems";

const getMediaAccess = vi.fn();
vi.mock("@/lib/media", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/media")>()),
  getMediaAccess: (...a: unknown[]) => getMediaAccess(...a),
}));

const user = userEvent.setup();
afterEach(() => {
  vi.clearAllMocks();
});

function item(over: Partial<PostMediaItem> = {}): PostMediaItem {
  return { mediaAssetId: "asset-1", sortOrder: 0, kind: "image", width: 400, height: 300, ...over };
}

describe("toGalleryItems", () => {
  it("sorts by sortOrder and derives kind from the mime type", () => {
    const items = toGalleryItems([
      { mediaAssetId: "b", sortOrder: 1, mimeType: "video/mp4", width: null, height: null, durationSeconds: 12 },
      { mediaAssetId: "a", sortOrder: 0, mimeType: "image/png", width: 10, height: 10, durationSeconds: null },
    ]);
    expect(items.map((i) => [i.mediaAssetId, i.kind])).toEqual([
      ["a", "image"],
      ["b", "video"],
    ]);
  });
});

describe("MediaGallery", () => {
  it("resolves each item through GET /media/:id/access and renders the image", async () => {
    getMediaAccess.mockResolvedValue({ ok: true, url: "blob:signed-1", expiresAt: new Date(Date.now() + 60_000).toISOString() });
    render(<MediaGallery items={[item()]} />);

    await waitFor(() => expect(screen.getByRole("button", { name: /view image/i })).toBeInTheDocument());
    expect(getMediaAccess).toHaveBeenCalledWith("asset-1");
    expect(document.querySelector("img")).toHaveAttribute("src", "blob:signed-1");
  });

  it("shows a locked treatment (no <img>) when access is 403", async () => {
    getMediaAccess.mockResolvedValue({ ok: false, reason: "locked" });
    render(<MediaGallery items={[item()]} />);

    await waitFor(() => expect(screen.getByText(/locked attachment/i)).toBeInTheDocument());
    expect(document.querySelector("img")).toBeNull();
  });

  it("blurs NSFW media until the viewer reveals it", async () => {
    getMediaAccess.mockResolvedValue({ ok: true, url: "blob:nsfw", expiresAt: new Date(Date.now() + 60_000).toISOString() });
    render(<MediaGallery items={[item({ nsfw: true })]} />);

    const revealBtn = await screen.findByRole("button", { name: /reveal sensitive media/i });
    expect(document.querySelector("img")!.className).toContain("blur-2xl");

    await user.click(revealBtn);
    await waitFor(() => expect(document.querySelector("img")!.className).not.toContain("blur-2xl"));
  });
});
