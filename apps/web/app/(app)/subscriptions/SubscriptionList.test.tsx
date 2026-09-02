import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { shortDate } from "@/lib/format";
import type { ListedSubscription } from "@/lib/subscriptions";
import { SubscriptionList } from "./SubscriptionList";

const PERIOD_END = shortDate("2026-02-01T00:00:00.000Z");

const apiFetchMock = vi.fn();
vi.mock("@/lib/apiFetch", () => ({ apiFetch: (...a: unknown[]) => apiFetchMock(...a) }));
vi.mock("@/lib/csrf", () => ({ csrfHeaders: () => ({}) }));

const toastMock = vi.fn();
vi.mock("@/components/ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/ui")>()),
  toast: (...a: unknown[]) => toastMock(...a),
}));

const user = userEvent.setup();

function sub(over: Partial<ListedSubscription> = {}): ListedSubscription {
  return {
    id: "s1",
    creatorId: "c1",
    tierId: "t1",
    status: "ACTIVE",
    priceCentsAtSubscription: 500,
    currencyAtSubscription: "usd",
    currentPeriodStart: "2026-01-01T00:00:00.000Z",
    currentPeriodEnd: "2026-02-01T00:00:00.000Z",
    cancelAtPeriodEnd: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    creator: { did: "did:plc:c1", handle: "ada.test", displayName: "Ada" },
    tier: { id: "t1", name: "Supporter" },
    ...over,
  };
}

beforeEach(() => {
  apiFetchMock.mockReset();
  toastMock.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe("SubscriptionList", () => {
  it("shows an empty state with a discover CTA when there are none", () => {
    render(<SubscriptionList initialSubscriptions={[]} />);
    expect(screen.getByText("No subscriptions yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /find creators/i })).toHaveAttribute("href", "/discover");
  });

  it("renders creator, tier, snapshot price, status and the renewal date", () => {
    render(<SubscriptionList initialSubscriptions={[sub()]} />);
    expect(screen.getByRole("link", { name: "Ada" })).toHaveAttribute("href", "/c/ada.test");
    expect(screen.getByText(/Supporter · \$5\.00 \/ month/)).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText(`Renews ${PERIOD_END}`)).toBeInTheDocument();
  });

  it("shows the past-due banner and a disabled payment-update button", () => {
    render(<SubscriptionList initialSubscriptions={[sub({ status: "PAST_DUE" })]} />);
    expect(screen.getByText(/last payment failed/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /update payment method/i })).toBeDisabled();
  });

  it("offers Resubscribe (not the cancel toggle) once canceled", () => {
    render(<SubscriptionList initialSubscriptions={[sub({ status: "CANCELED", cancelAtPeriodEnd: true })]} />);
    expect(screen.getByRole("link", { name: "Resubscribe" })).toHaveAttribute("href", "/c/ada.test");
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });

  it("optimistically flips the cancel toggle and PATCHes the subscription", async () => {
    apiFetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: "s1", cancelAtPeriodEnd: true }) });

    render(<SubscriptionList initialSubscriptions={[sub()]} />);
    await user.click(screen.getByRole("switch", { name: /cancel ada at renewal/i }));

    expect(apiFetchMock).toHaveBeenCalledWith(
      "/subscriptions/s1",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ cancelAtPeriodEnd: true }) }),
    );
    expect(await screen.findByText(`Cancels — access until ${PERIOD_END}`)).toBeInTheDocument();
  });

  it("reverts the toggle if the PATCH fails", async () => {
    apiFetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: { message: "boom" } }) });

    render(<SubscriptionList initialSubscriptions={[sub()]} />);
    const toggle = screen.getByRole("switch", { name: /cancel ada at renewal/i });
    await user.click(toggle);

    await vi.waitFor(() => expect(toastMock).toHaveBeenCalled());
    expect(toggle).toHaveAttribute("aria-checked", "false");
  });
});
