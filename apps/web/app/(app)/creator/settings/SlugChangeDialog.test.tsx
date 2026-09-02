import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SlugChangeDialog } from "./SlugChangeDialog";

const apiFetchMock = vi.fn();
vi.mock("@/lib/apiFetch", () => ({ apiFetch: (...a: unknown[]) => apiFetchMock(...a) }));
vi.mock("@/lib/csrf", () => ({ csrfHeaders: () => ({}) }));

const user = userEvent.setup({ delay: null });

beforeEach(() => {
  Object.defineProperty(window, "location", { value: { assign: vi.fn() }, writable: true });
  apiFetchMock.mockReset();
  apiFetchMock.mockResolvedValue({ status: 404, ok: false }); // any candidate slug is free
});
afterEach(() => vi.restoreAllMocks());

async function open() {
  render(<SlugChangeDialog currentSlug="ada" />);
  await user.click(screen.getByRole("button", { name: "Change slug" }));
}

describe("SlugChangeDialog", () => {
  it("spells out that existing links break and is disabled until a valid new slug is entered", async () => {
    await open();
    expect(screen.getByRole("dialog")).toHaveTextContent(/every existing link to .*\/c\/ada.* will break/i);
    expect(screen.getByRole("dialog")).toHaveTextContent(/once every 7 days/i);

    const confirm = screen.getByRole("button", { name: /change slug & break old links/i });
    expect(confirm).toBeDisabled();

    await user.type(screen.getByLabelText("New slug"), "ada-new");
    await vi.waitFor(() => expect(confirm).toBeEnabled());
  });

  it("PATCHes /creators/me and navigates to the new page on success", async () => {
    await open();
    await user.type(screen.getByLabelText("New slug"), "ada-new");
    const confirm = screen.getByRole("button", { name: /change slug & break old links/i });
    await vi.waitFor(() => expect(confirm).toBeEnabled());

    apiFetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ slug: "ada-new" }) });
    await user.click(confirm);

    expect(apiFetchMock).toHaveBeenCalledWith(
      "/creators/me",
      expect.objectContaining({ method: "PATCH" }),
    );
    await vi.waitFor(() => expect(window.location.assign).toHaveBeenCalledWith("/c/ada-new"));
  });

  it("surfaces the cooldown error from a 429", async () => {
    await open();
    await user.type(screen.getByLabelText("New slug"), "ada-new");
    const confirm = screen.getByRole("button", { name: /change slug & break old links/i });
    await vi.waitFor(() => expect(confirm).toBeEnabled());

    apiFetchMock.mockResolvedValueOnce({
      ok: false,
      status: 429,
      json: async () => ({ error: { message: "Slug can only be changed once every 7 days. Try again in 4 day(s)." } }),
    });
    await user.click(confirm);

    expect(await screen.findByRole("alert")).toHaveTextContent(/once every 7 days/i);
  });
});
