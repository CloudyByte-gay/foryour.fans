import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OnboardingWizard } from "./OnboardingWizard";

const apiFetchMock = vi.fn();
vi.mock("@/lib/apiFetch", () => ({ apiFetch: (...a: unknown[]) => apiFetchMock(...a) }));
vi.mock("@/lib/csrf", () => ({ csrfHeaders: () => ({ "x-csrf-token": "test" }) }));

const user = userEvent.setup({ delay: null });

beforeEach(() => {
  Object.defineProperty(window, "location", { value: { assign: vi.fn(), href: "" }, writable: true });
  apiFetchMock.mockReset();
});
afterEach(() => vi.restoreAllMocks());

function renderWizard() {
  render(<OnboardingWizard handle="ada.test" did="did:plc:ada" />);
}

async function advanceToReview() {
  // Step 1 — profile
  await user.type(await screen.findByLabelText(/display name/i), "Ada");
  await user.click(screen.getByRole("button", { name: "Continue" }));
  // Step 2 — content rating
  await user.click(await screen.findByRole("button", { name: "Continue" }));
  // Step 3 — review
  return screen.findByRole("button", { name: /publish creator account/i });
}

describe("OnboardingWizard", () => {
  it("is a 3-step flow with no slug step", async () => {
    renderWizard();
    expect(screen.queryByLabelText(/slug/i)).not.toBeInTheDocument();
    // First step is the profile step.
    expect(await screen.findByLabelText(/display name/i)).toBeInTheDocument();
  });

  it("walks to review and POSTs profile-only to /creators, then lands on /c/<handle>", async () => {
    renderWizard();
    const publish = await advanceToReview();

    expect(screen.getAllByText("/c/ada.test").length).toBeGreaterThan(0);

    apiFetchMock.mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ handle: "ada.test" }) });
    await user.click(publish);

    expect(apiFetchMock).toHaveBeenCalledWith(
      "/creators",
      expect.objectContaining({ method: "POST" }),
    );
    const body = JSON.parse((apiFetchMock.mock.calls[0]![1] as { body: string }).body) as Record<string, unknown>;
    expect(body).toEqual({ displayName: "Ada" });
    expect(body).not.toHaveProperty("slug");

    await vi.waitFor(() => expect(window.location.assign).toHaveBeenCalledWith("/c/ada.test"));
  });

  it("surfaces a server error on the review step without leaving it", async () => {
    renderWizard();
    const publish = await advanceToReview();

    apiFetchMock.mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: async () => ({ error: { message: "Failed to publish creator profile to the AT network.", statusCode: 502 } }),
    });
    await user.click(publish);

    expect(await screen.findByText(/failed to publish/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /publish creator account/i })).toBeInTheDocument();
  });
});
