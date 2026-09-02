import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PostComposer } from "./PostComposer";
import type { TierOption } from "@/lib/post";

const apiFetchMock = vi.fn();
vi.mock("@/lib/apiFetch", () => ({ apiFetch: (...a: unknown[]) => apiFetchMock(...a) }));
vi.mock("@/lib/csrf", () => ({ csrfHeaders: () => ({ "x-csrf-token": "test" }) }));

const pushMock = vi.fn();
const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock, refresh: refreshMock }) }));

const toastMock = vi.fn();
vi.mock("@/components/ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/ui")>()),
  toast: (...a: unknown[]) => toastMock(...a),
}));

const user = userEvent.setup({ delay: null });

const TIERS: TierOption[] = [
  { id: "11111111-1111-1111-1111-111111111111", name: "Gold", priceCents: 900, currency: "usd", isActive: true },
];

beforeEach(() => {
  apiFetchMock.mockReset();
  pushMock.mockReset();
  toastMock.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe("PostComposer", () => {
  it("shows the mandated warning only while Public is selected", async () => {
    render(<PostComposer mode="create" tiers={TIERS} />);
    expect(screen.queryByText(/replicated by other apps/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: /public/i }));
    expect(screen.getByText(/replicated by other apps/i)).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: /subscribers/i }));
    expect(screen.queryByText(/replicated by other apps/i)).not.toBeInTheDocument();
  });

  it("reveals the tier picker for Specific tier", async () => {
    render(<PostComposer mode="create" tiers={TIERS} />);
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: /specific tier/i }));
    expect(screen.getByRole("combobox")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Gold/ })).toBeInTheDocument();
  });

  it("points a creator with no active tiers at tier setup", async () => {
    render(<PostComposer mode="create" tiers={[]} />);
    await user.click(screen.getByRole("radio", { name: /specific tier/i }));
    expect(screen.getByRole("link", { name: /create one first/i })).toHaveAttribute("href", "/creator/tiers");
  });

  it("POSTs a plain subscriber post and returns to the list", async () => {
    apiFetchMock.mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ id: "p1" }) });
    render(<PostComposer mode="create" tiers={TIERS} />);

    await user.type(screen.getByLabelText("Post"), "hello subscribers");
    await user.click(screen.getByRole("button", { name: "Publish" }));

    expect(apiFetchMock).toHaveBeenCalledWith(
      "/creators/me/posts",
      expect.objectContaining({ method: "POST" }),
    );
    const body = JSON.parse(apiFetchMock.mock.calls[0][1].body as string);
    expect(body).toEqual({ visibility: "SUBSCRIBERS", text: "hello subscribers" });
    expect(pushMock).toHaveBeenCalledWith("/creator/posts");
  });

  it("blocks submit with a validation message when TIER has no tier chosen", async () => {
    render(<PostComposer mode="create" tiers={TIERS} />);
    await user.type(screen.getByLabelText("Post"), "premium thing");
    await user.click(screen.getByRole("radio", { name: /specific tier/i }));
    await user.click(screen.getByRole("button", { name: "Publish" }));

    expect(apiFetchMock).not.toHaveBeenCalled();
    expect(screen.getByText(/pick which tier unlocks this post/i)).toBeInTheDocument();
  });

  it("PATCHes in edit mode, seeded from the post", async () => {
    apiFetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: "p9" }) });
    render(
      <PostComposer
        mode="edit"
        tiers={TIERS}
        post={{
          id: "p9",
          creatorId: "c1",
          visibility: "SUBSCRIBERS",
          minimumTierId: null,
          text: "original",
          media: [],
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        }}
      />,
    );

    const textarea = screen.getByLabelText("Post");
    expect(textarea).toHaveValue("original");
    await user.clear(textarea);
    await user.type(textarea, "revised");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(apiFetchMock).toHaveBeenCalledWith(
      "/creators/me/posts/p9",
      expect.objectContaining({ method: "PATCH" }),
    );
    const body = JSON.parse(apiFetchMock.mock.calls[0][1].body as string);
    expect(body).toEqual({ visibility: "SUBSCRIBERS", text: "revised" });
  });
});
