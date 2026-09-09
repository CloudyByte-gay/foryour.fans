import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/lib/session";
import { AccountTab } from "./AccountTab";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
}));

const apiFetchMock = vi.fn();
vi.mock("@/lib/apiFetch", () => ({ apiFetch: (...args: unknown[]) => apiFetchMock(...args) }));

const user = userEvent.setup();

const me: SessionUser = {
  did: "did:plc:abcdef123456",
  handle: "ada.example",
  displayName: "Ada Lovelace",
  avatarUrl: null,
  bannerUrl: null,
  role: "USER",
  status: "ACTIVE",
};

afterEach(() => {
  apiFetchMock.mockReset();
  vi.restoreAllMocks();
});

describe("AccountTab", () => {
  it("shows the DID with a copy control and labels it immutable", () => {
    render(<AccountTab me={me} />);
    expect(screen.getByText("did:plc:abcdef123456")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy DID" })).toBeInTheDocument();
    expect(screen.getByText(/immutable/i)).toBeInTheDocument();
    expect(screen.getAllByText("Cached from Bluesky").length).toBeGreaterThan(0);
  });

  it("re-pulls the profile on Refresh and shows the new values", async () => {
    apiFetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        did: me.did,
        handle: "ada.new",
        displayName: "Ada L.",
        avatarUrl: null,
        bannerUrl: null,
      }),
    });

    render(<AccountTab me={me} />);
    await user.click(screen.getByRole("button", { name: /refresh from bluesky/i }));

    expect(apiFetchMock).toHaveBeenCalledWith("/me/refresh", expect.objectContaining({ method: "POST" }));
    await screen.findAllByText("Ada L.");
    expect(screen.getAllByText("@ada.new").length).toBeGreaterThan(0);
    expect(screen.queryByText("@ada.example")).not.toBeInTheDocument();
  });

  it("surfaces a refresh failure without changing the displayed profile", async () => {
    apiFetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: { message: "Couldn't reach your Bluesky account." } }),
    });

    render(<AccountTab me={me} />);
    await user.click(screen.getByRole("button", { name: /refresh from bluesky/i }));

    // Profile is unchanged after a failed refresh.
    await vi.waitFor(() => expect(apiFetchMock).toHaveBeenCalled());
    expect(screen.getAllByText("@ada.example").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Ada Lovelace").length).toBeGreaterThan(0);
  });
});
