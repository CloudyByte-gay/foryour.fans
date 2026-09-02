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

/** Default: any GET /creators/:slug → 404 (available). */
function slugAvailable() {
  apiFetchMock.mockImplementation(async (path: string) =>
    path.startsWith("/creators/") ? { status: 404, ok: false } : { ok: true, json: async () => ({}) },
  );
}

async function fillSlugAndContinue(slug: string) {
  await user.type(screen.getByLabelText("Page slug"), slug);
  const button = await screen.findByRole("button", { name: "Continue" });
  await vi.waitFor(() => expect(button).toBeEnabled());
  await user.click(button);
}

describe("OnboardingWizard", () => {
  it("blocks Continue until the slug is valid and available", async () => {
    slugAvailable();
    render(<OnboardingWizard />);

    await user.type(screen.getByLabelText("Page slug"), "ab"); // too short
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();

    await user.type(screen.getByLabelText("Page slug"), "cdef"); // -> "abcdef"
    await vi.waitFor(() =>
      expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled(),
    );
  });

  it("walks to review and POSTs to /creators", async () => {
    slugAvailable();
    render(<OnboardingWizard />);

    await fillSlugAndContinue("ada-test");
    // Profile step
    await user.type(await screen.findByLabelText(/display name/i), "Ada");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    // Rating step
    await user.click(await screen.findByRole("button", { name: "Continue" }));
    // Review step
    const publish = await screen.findByRole("button", { name: /publish creator account/i });

    apiFetchMock.mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({ slug: "ada-test" }) });
    await user.click(publish);

    expect(apiFetchMock).toHaveBeenCalledWith(
      "/creators",
      expect.objectContaining({ method: "POST" }),
    );
    await vi.waitFor(() => expect(window.location.assign).toHaveBeenCalledWith("/c/ada-test"));
  });

  it("shows a taken-slug error and returns to the slug step", async () => {
    slugAvailable();
    render(<OnboardingWizard />);

    await fillSlugAndContinue("ada-test");
    await user.click(await screen.findByRole("button", { name: "Continue" })); // profile
    await user.click(await screen.findByRole("button", { name: "Continue" })); // rating
    const publish = await screen.findByRole("button", { name: /publish creator account/i });

    apiFetchMock.mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({ error: { message: 'Slug "ada-test" is already taken.', statusCode: 409 } }),
    });
    await user.click(publish);

    expect(await screen.findByText(/already taken/i)).toBeInTheDocument();
    // back on step 1
    expect(screen.getByLabelText("Page slug")).toBeInTheDocument();
  });
});
