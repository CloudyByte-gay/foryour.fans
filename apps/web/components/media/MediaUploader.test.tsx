import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { MediaUploader } from "./MediaUploader";
import type { Attachment } from "@/lib/media";

const requestUploadUrl = vi.fn();
const putBytes = vi.fn();
const completeUpload = vi.fn();
const getAssetStatus = vi.fn();

vi.mock("@/lib/media", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/media")>()),
  requestUploadUrl: (...a: unknown[]) => requestUploadUrl(...a),
  putBytes: (...a: unknown[]) => putBytes(...a),
  completeUpload: (...a: unknown[]) => completeUpload(...a),
  getAssetStatus: (...a: unknown[]) => getAssetStatus(...a),
  probeDimensions: async () => ({ width: 100, height: 100 }),
}));

beforeAll(() => {
  Object.defineProperty(URL, "createObjectURL", { value: () => "blob:preview", writable: true });
  Object.defineProperty(URL, "revokeObjectURL", { value: () => {}, writable: true });
});

const user = userEvent.setup();
afterEach(() => vi.clearAllMocks());

function Harness({ onState }: { onState?: (a: Attachment[]) => void }) {
  const [value, setValue] = useState<Attachment[]>([]);
  return (
    <MediaUploader
      value={value}
      onChange={(next) => {
        setValue(next);
        onState?.(next);
      }}
    />
  );
}

function makeFile(name: string, type: string, size = 1024): File {
  const f = new File(["x".repeat(size)], name, { type });
  Object.defineProperty(f, "size", { value: size });
  return f;
}

describe("MediaUploader", () => {
  it("rejects a dropped unsupported file locally and never requests a presigned URL", async () => {
    render(<Harness />);
    // Drop bypasses the file input's `accept` filter — the client-side guard is what stops it.
    fireEvent.drop(screen.getByText(/drag photos or videos/i).closest("label")!, {
      dataTransfer: { files: [makeFile("notes.pdf", "application/pdf")] },
    });

    expect(await screen.findByText(/only jpeg, png/i)).toBeInTheDocument();
    expect(requestUploadUrl).not.toHaveBeenCalled();
  });

  it("takes a valid image through upload → processing → ready", async () => {
    requestUploadUrl.mockResolvedValue({
      ok: true,
      intent: { id: "asset-9", uploadUrl: "https://storage.test/put", uploadUrlExpiresAt: "" },
    });
    putBytes.mockResolvedValue(undefined);
    completeUpload.mockResolvedValue({ ok: true, asset: { id: "asset-9", status: "READY" } });

    const states: Attachment[][] = [];
    render(<Harness onState={(a) => states.push(a)} />);
    await user.upload(document.querySelector('input[type="file"]') as HTMLInputElement, makeFile("pic.png", "image/png"));

    await waitFor(() => expect(screen.getByText(/^Ready/)).toBeInTheDocument());
    expect(putBytes).toHaveBeenCalledWith("https://storage.test/put", expect.any(File), expect.any(Object));
    const last = states.at(-1)!;
    expect(last).toHaveLength(1);
    expect(last[0]).toMatchObject({ assetId: "asset-9", status: "ready" });
  });

  it("surfaces a REJECTED processing result as an error row", async () => {
    requestUploadUrl.mockResolvedValue({
      ok: true,
      intent: { id: "asset-x", uploadUrl: "https://storage.test/put", uploadUrlExpiresAt: "" },
    });
    putBytes.mockResolvedValue(undefined);
    completeUpload.mockResolvedValue({ ok: true, asset: { id: "asset-x", status: "REJECTED" } });

    render(<Harness />);
    await user.upload(document.querySelector('input[type="file"]') as HTMLInputElement, makeFile("bad.png", "image/png"));

    expect(await screen.findByText(/rejected during processing/i)).toBeInTheDocument();
  });
});
