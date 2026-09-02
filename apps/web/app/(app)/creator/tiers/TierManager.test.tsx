import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TierManager, reorder } from "./TierManager";
import type { OwnTier } from "./page";

const apiFetchMock = vi.fn();
vi.mock("@/lib/apiFetch", () => ({ apiFetch: (...a: unknown[]) => apiFetchMock(...a) }));
vi.mock("@/lib/csrf", () => ({ csrfHeaders: () => ({ "x-csrf-token": "test" }) }));

const toastMock = vi.fn();
vi.mock("@/components/ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/ui")>()),
  toast: (...a: unknown[]) => toastMock(...a),
}));

const user = userEvent.setup({ delay: null });

function tier(over: Partial<OwnTier> = {}): OwnTier {
  return {
    id: "t1",
    name: "Supporter",
    description: null,
    priceCents: 500,
    currency: "usd",
    sortOrder: 0,
    isActive: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

beforeEach(() => {
  apiFetchMock.mockReset();
  toastMock.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe("reorder()", () => {
  const list = [tier({ id: "a", sortOrder: 0 }), tier({ id: "b", sortOrder: 1 }), tier({ id: "c", sortOrder: 2 })];

  it("moves an item and renumbers sortOrder by index", () => {
    const next = reorder(list, "a", "c");
    expect(next.map((t) => t.id)).toEqual(["b", "c", "a"]);
    expect(next.map((t) => t.sortOrder)).toEqual([0, 1, 2]);
  });

  it("is a no-op when the ids are unknown or equal", () => {
    expect(reorder(list, "a", "a")).toBe(list);
    expect(reorder(list, "a", "zzz")).toBe(list);
  });
});

describe("TierManager", () => {
  it("groups active tiers above a 'Deactivated' section", () => {
    render(
      <TierManager
        pageAddress="ada.test"
        initialTiers={[
          tier({ id: "a", name: "Bronze", sortOrder: 0 }),
          tier({ id: "b", name: "Retired", isActive: false }),
        ]}
      />,
    );
    expect(screen.getByText("Bronze")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Deactivated" })).toBeInTheDocument();
    expect(screen.getByLabelText("Reactivate Retired")).toBeInTheDocument();
  });

  it("shows the empty state with no tiers", () => {
    render(<TierManager pageAddress="ada.test" initialTiers={[]} />);
    expect(screen.getByText("No tiers yet")).toBeInTheDocument();
  });

  it("creates a tier: POSTs the parsed body and renders the new row", async () => {
    render(<TierManager pageAddress="ada.test" initialTiers={[tier({ id: "a", name: "Bronze" })]} />);

    await user.click(screen.getByRole("button", { name: /new tier/i }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("Name"), "Gold");
    await user.type(within(dialog).getByLabelText(/price \/ month/i), "9.99");

    apiFetchMock.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => tier({ id: "new", name: "Gold", priceCents: 999 }),
    });
    await user.click(within(dialog).getByRole("button", { name: "Create tier" }));

    expect(apiFetchMock).toHaveBeenCalledWith("/creators/me/tiers", expect.objectContaining({ method: "POST" }));
    const body = JSON.parse((apiFetchMock.mock.calls[0]![1] as { body: string }).body);
    expect(body).toEqual({ name: "Gold", priceCents: 999, currency: "usd" });
    expect(await screen.findByText("Gold")).toBeInTheDocument();
  });

  it("re-opening the create dialog starts from a blank form (no leftover state)", async () => {
    render(<TierManager pageAddress="ada.test" initialTiers={[tier({ id: "a", name: "Bronze" })]} />);

    await user.click(screen.getByRole("button", { name: /new tier/i }));
    await user.type(within(screen.getByRole("dialog")).getByLabelText("Name"), "Draft I abandon");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));

    await user.click(screen.getByRole("button", { name: /new tier/i }));
    expect(within(screen.getByRole("dialog")).getByLabelText("Name")).toHaveValue("");
  });

  it("deactivating asks for confirmation with the deactivate-not-delete copy, then DELETEs", async () => {
    render(<TierManager pageAddress="ada.test" initialTiers={[tier({ id: "a", name: "Bronze" })]} />);

    await user.click(screen.getByLabelText("Deactivate Bronze"));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/deactivated, not deleted/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/existing subscribers keep their access/i)).toBeInTheDocument();

    apiFetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => tier({ id: "a", name: "Bronze", isActive: false }),
    });
    await user.click(within(dialog).getByRole("button", { name: "Deactivate tier" }));

    expect(apiFetchMock).toHaveBeenCalledWith(
      "/creators/me/tiers/a",
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(await screen.findByRole("heading", { name: "Deactivated" })).toBeInTheDocument();
  });

  it("shows the price-grandfathering callout only once the price is edited", async () => {
    render(
      <TierManager
        pageAddress="ada.test"
        initialTiers={[tier({ id: "a", name: "Bronze", priceCents: 500 })]}
      />,
    );

    await user.click(screen.getByRole("button", { name: /edit/i }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByText(/change what current subscribers pay/i)).not.toBeInTheDocument();

    const price = within(dialog).getByLabelText(/price \/ month/i);
    await user.clear(price);
    await user.type(price, "7.50");
    expect(within(dialog).getByText(/change what current subscribers pay/i)).toBeInTheDocument();
  });
});
