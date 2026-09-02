import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PayoutOnboarding } from "./PayoutOnboarding";

const apiFetchMock = vi.fn();
vi.mock("@/lib/apiFetch", () => ({ apiFetch: (...a: unknown[]) => apiFetchMock(...a) }));
vi.mock("@/lib/csrf", () => ({ csrfHeaders: () => ({}) }));

const toastMock = vi.fn();
vi.mock("@/components/ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/ui")>()),
  toast: (...a: unknown[]) => toastMock(...a),
}));

const user = userEvent.setup();
let assignSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  apiFetchMock.mockReset();
  toastMock.mockReset();
  assignSpy = vi.fn();
  Object.defineProperty(window, "location", { value: { assign: assignSpy }, writable: true });
});
afterEach(() => vi.restoreAllMocks());

describe("PayoutOnboarding", () => {
  it("gates 'Start payout onboarding' behind the age/identity self-declaration", async () => {
    render(<PayoutOnboarding initialStatus="NOT_STARTED" />);

    const start = screen.getByRole("button", { name: /start payout onboarding/i });
    expect(start).toBeDisabled();

    await user.click(screen.getByRole("checkbox"));
    expect(start).toBeEnabled();
  });

  it("POSTs and redirects to the provider onboarding URL", async () => {
    apiFetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ status: "PENDING", onboardingUrl: "https://payouts.test/onboard/1" }),
    });

    render(<PayoutOnboarding initialStatus="NOT_STARTED" />);
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: /start payout onboarding/i }));

    expect(apiFetchMock).toHaveBeenCalledWith(
      "/creators/me/payout-account",
      expect.objectContaining({ method: "POST" }),
    );
    expect(assignSpy).toHaveBeenCalledWith("https://payouts.test/onboard/1");
  });

  it("pending state explains subscriptions still work and offers a manual refresh", () => {
    render(<PayoutOnboarding initialStatus="PENDING" />);
    expect(screen.getByText(/verification in progress/i)).toBeInTheDocument();
    expect(screen.getByText(/keep publishing and taking subscriptions/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /refresh status/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /start payout onboarding/i })).not.toBeInTheDocument();
  });

  it("restricted state lets the creator restart onboarding", () => {
    render(<PayoutOnboarding initialStatus="RESTRICTED" />);
    expect(screen.getByText(/restricted/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /restart payout onboarding/i })).toBeInTheDocument();
  });

  it("verified state needs no action", () => {
    render(<PayoutOnboarding initialStatus="VERIFIED" />);
    expect(screen.getByText(/no further action needed/i)).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });
});
