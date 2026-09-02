import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SubscribeReturn } from "./SubscribeReturn";

const apiFetchMock = vi.fn();
vi.mock("@/lib/apiFetch", () => ({ apiFetch: (...a: unknown[]) => apiFetchMock(...a) }));

function seedContext() {
  window.sessionStorage.setItem(
    "ff.subscribeReturn",
    JSON.stringify({ address: "ada.test", creatorName: "Ada", subscriptionId: "sub_1" }),
  );
}

beforeEach(() => {
  apiFetchMock.mockReset();
  window.sessionStorage.clear();
});
afterEach(() => vi.restoreAllMocks());

describe("SubscribeReturn", () => {
  it("shows the unlocked success state when the subscription is ACTIVE", async () => {
    seedContext();
    apiFetchMock.mockResolvedValue({ ok: true, json: async () => [{ id: "sub_1", status: "ACTIVE" }] });

    render(<SubscribeReturn />);

    expect(await screen.findByText(/you.re subscribed/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /go to ada/i })).toHaveAttribute("href", "/c/ada.test");
  });

  it("shows the failure state for a non-active, non-pending outcome", async () => {
    seedContext();
    apiFetchMock.mockResolvedValue({ ok: true, json: async () => [{ id: "sub_1", status: "CANCELED" }] });

    render(<SubscribeReturn />);

    expect(await screen.findByText(/didn.t go through/i)).toBeInTheDocument();
    expect(screen.getByText(/haven.t been charged/i)).toBeInTheDocument();
  });

  it("surfaces a reconciliation error with a retry", async () => {
    seedContext();
    apiFetchMock.mockRejectedValue(new Error("offline"));

    render(<SubscribeReturn />);

    expect(await screen.findByText(/couldn.t check your subscription/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });
});
