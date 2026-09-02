import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SUBSCRIPTION_STATUS_META,
  isCancelable,
  isResubscribable,
  setCancelAtPeriodEnd,
  stashSubscribeReturn,
  subscribeToTier,
  takeSubscribeReturn,
  type SubscriptionStatus,
} from "./subscriptions";

const apiFetchMock = vi.fn();
vi.mock("@/lib/apiFetch", () => ({ apiFetch: (...a: unknown[]) => apiFetchMock(...a) }));
vi.mock("@/lib/csrf", () => ({ csrfHeaders: () => ({ "x-csrf-token": "test" }) }));

afterEach(() => {
  apiFetchMock.mockReset();
  window.sessionStorage.clear();
});

const ALL: SubscriptionStatus[] = ["PENDING", "ACTIVE", "PAST_DUE", "CANCELED", "EXPIRED"];

describe("status helpers", () => {
  it("has a label + badge for every status", () => {
    for (const s of ALL) {
      expect(SUBSCRIPTION_STATUS_META[s].label).toBeTruthy();
      expect(SUBSCRIPTION_STATUS_META[s].badge).toBeTruthy();
    }
  });

  it("only offers resubscribe for canceled/expired", () => {
    expect(ALL.filter(isResubscribable)).toEqual(["CANCELED", "EXPIRED"]);
  });

  it("only offers the cancel toggle while a subscription is live-ish", () => {
    expect(ALL.filter(isCancelable)).toEqual(["PENDING", "ACTIVE", "PAST_DUE"]);
  });
});

describe("subscribeToTier", () => {
  it("returns the subscription + redirectUrl on 201", async () => {
    apiFetchMock.mockResolvedValue({
      status: 201,
      json: async () => ({ id: "sub_1", status: "PENDING", redirectUrl: "https://checkout.test/s/1" }),
    });

    const outcome = await subscribeToTier("ada.test", "tier_1");

    expect(apiFetchMock).toHaveBeenCalledWith(
      "/creators/ada.test/subscribe",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ tierId: "tier_1" }) }),
    );
    expect(outcome).toEqual({
      ok: true,
      result: { id: "sub_1", status: "PENDING", redirectUrl: "https://checkout.test/s/1" },
    });
  });

  it("maps 409 to an already-subscribed outcome", async () => {
    apiFetchMock.mockResolvedValue({ status: 409, json: async () => ({}) });
    const outcome = await subscribeToTier("ada.test", "tier_1");
    expect(outcome).toMatchObject({ ok: false, code: "already_subscribed" });
  });

  it("maps a thrown fetch to an error outcome", async () => {
    apiFetchMock.mockRejectedValue(new Error("offline"));
    const outcome = await subscribeToTier("ada.test", "tier_1");
    expect(outcome).toMatchObject({ ok: false, code: "error" });
  });
});

describe("setCancelAtPeriodEnd", () => {
  it("PATCHes the flag and returns the updated row", async () => {
    apiFetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: "s1", cancelAtPeriodEnd: true }) });
    const res = await setCancelAtPeriodEnd("s1", true);
    expect(apiFetchMock).toHaveBeenCalledWith(
      "/subscriptions/s1",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ cancelAtPeriodEnd: true }) }),
    );
    expect(res).toMatchObject({ ok: true, subscription: { id: "s1", cancelAtPeriodEnd: true } });
  });

  it("reports a failure message on a non-ok response", async () => {
    apiFetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: { message: "nope" } }) });
    const res = await setCancelAtPeriodEnd("s1", true);
    expect(res).toEqual({ ok: false, message: "nope" });
  });
});

describe("subscribe return context", () => {
  it("round-trips through sessionStorage and clears on read", () => {
    stashSubscribeReturn({ address: "ada.test", creatorName: "Ada", subscriptionId: "s1" });
    expect(takeSubscribeReturn()).toEqual({ address: "ada.test", creatorName: "Ada", subscriptionId: "s1" });
    expect(takeSubscribeReturn()).toBeNull();
  });
});
