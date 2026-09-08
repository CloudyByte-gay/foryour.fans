import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublicTier } from "@/components/creator/TierCard";
import { SubscribeButton } from "./SubscribeButton";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock }) }));

const apiFetchMock = vi.fn();
vi.mock("@/lib/apiFetch", () => ({ apiFetch: (...a: unknown[]) => apiFetchMock(...a) }));
vi.mock("@/lib/csrf", () => ({ csrfHeaders: () => ({}) }));

const toastMock = vi.fn();
vi.mock("@/components/ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/ui")>()),
  toast: (...a: unknown[]) => toastMock(...a),
}));

const tier: PublicTier = {
  id: "tier_1",
  name: "Gold",
  description: null,
  priceCents: 999,
  currency: "usd",
  sortOrder: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
};

const adultTier: PublicTier = { ...tier, containsAdultContent: true };

const user = userEvent.setup();
let assignSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  apiFetchMock.mockReset();
  pushMock.mockReset();
  toastMock.mockReset();
  window.sessionStorage.clear();
  window.localStorage.clear();
  assignSpy = vi.fn();
  Object.defineProperty(window, "location", { value: { assign: assignSpy }, writable: true });
});
afterEach(() => vi.restoreAllMocks());

describe("SubscribeButton", () => {
  it("links anonymous visitors to login with a next back to the creator", () => {
    render(<SubscribeButton creatorAddress="ada.test" creatorName="Ada" tier={tier} isAuthed={false} />);
    const link = screen.getByRole("link", { name: "Subscribe" });
    expect(link).toHaveAttribute("href", "/login?next=%2Fc%2Fada.test");
  });

  it("shows the locked-in price in the review dialog and redirects to hosted checkout on confirm", async () => {
    apiFetchMock.mockResolvedValue({
      status: 201,
      json: async () => ({ id: "sub_9", status: "PENDING", redirectUrl: "https://checkout.test/s/9" }),
    });

    render(<SubscribeButton creatorAddress="ada.test" creatorName="Ada" tier={tier} isAuthed />);
    await user.click(screen.getByRole("button", { name: "Subscribe" }));

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("$9.99");
    expect(dialog).toHaveTextContent(/won.t change what you pay/i);

    await user.click(screen.getByRole("button", { name: /continue to checkout/i }));

    expect(apiFetchMock).toHaveBeenCalledWith(
      "/creators/ada.test/subscribe",
      expect.objectContaining({ method: "POST" }),
    );
    expect(assignSpy).toHaveBeenCalledWith("https://checkout.test/s/9");
    expect(window.sessionStorage.getItem("ff.subscribeReturn")).toContain("sub_9");
  });

  it("sends the viewer to their subscriptions when already subscribed (409)", async () => {
    apiFetchMock.mockResolvedValue({ status: 409, json: async () => ({}) });

    render(<SubscribeButton creatorAddress="ada.test" creatorName="Ada" tier={tier} isAuthed />);
    await user.click(screen.getByRole("button", { name: "Subscribe" }));
    await user.click(screen.getByRole("button", { name: /continue to checkout/i }));

    expect(pushMock).toHaveBeenCalledWith("/subscriptions");
    expect(assignSpy).not.toHaveBeenCalled();
  });

  it("shows the age gate before the review dialog for an adult tier", async () => {
    render(<SubscribeButton creatorAddress="ada.test" creatorName="Ada" tier={adultTier} isAuthed />);
    await user.click(screen.getByRole("button", { name: "Subscribe" }));

    expect(screen.getByText(/confirm your age/i)).toBeInTheDocument();
    expect(screen.queryByText(/won.t change what you pay/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /i.m 18 or older/i }));

    expect(screen.queryByText(/confirm your age/i)).not.toBeInTheDocument();
    expect(screen.getByRole("dialog")).toHaveTextContent(/won.t change what you pay/i);
    expect(window.localStorage.getItem("ff.ageConfirmed")).toBe("true");
  });

  it("skips the age gate for an adult tier once age is already confirmed", async () => {
    window.localStorage.setItem("ff.ageConfirmed", "true");
    render(<SubscribeButton creatorAddress="ada.test" creatorName="Ada" tier={adultTier} isAuthed />);
    await user.click(screen.getByRole("button", { name: "Subscribe" }));

    expect(screen.queryByText(/confirm your age/i)).not.toBeInTheDocument();
    expect(screen.getByRole("dialog")).toHaveTextContent(/won.t change what you pay/i);
  });
});
