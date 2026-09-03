import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchComments, postComment } from "./comments";

const apiFetchMock = vi.fn();
vi.mock("@/lib/apiFetch", () => ({ apiFetch: (...a: unknown[]) => apiFetchMock(...a) }));
vi.mock("@/lib/csrf", () => ({ csrfHeaders: () => ({ "x-csrf-token": "test" }) }));

afterEach(() => {
  apiFetchMock.mockReset();
});

describe("fetchComments", () => {
  it("GETs the first page with the default limit", async () => {
    apiFetchMock.mockResolvedValue({ ok: true, json: async () => ({ comments: [], nextCursor: null }) });
    await fetchComments("p1");
    expect(apiFetchMock).toHaveBeenCalledWith("/posts/p1/comments?limit=20");
  });

  it("includes the cursor for a later page", async () => {
    apiFetchMock.mockResolvedValue({ ok: true, json: async () => ({ comments: [], nextCursor: null }) });
    await fetchComments("p1", "c1");
    expect(apiFetchMock).toHaveBeenCalledWith("/posts/p1/comments?limit=20&cursor=c1");
  });

  it("throws on a non-ok response, for the caller to surface as an error state", async () => {
    apiFetchMock.mockResolvedValue({ ok: false, status: 500 });
    await expect(fetchComments("p1")).rejects.toThrow();
  });
});

describe("postComment", () => {
  it("returns the created comment on 201", async () => {
    const created = {
      id: "c1",
      postId: "p1",
      text: "hi",
      createdAt: "2026-01-01T00:00:00.000Z",
      author: { did: "did:plc:a", handle: "a.test", displayName: "A", avatarUrl: null },
    };
    apiFetchMock.mockResolvedValue({ status: 201, json: async () => created });

    const outcome = await postComment("p1", "hi");

    expect(apiFetchMock).toHaveBeenCalledWith(
      "/posts/p1/comments",
      expect.objectContaining({ method: "POST", body: JSON.stringify({ text: "hi" }) }),
    );
    expect(outcome).toEqual({ ok: true, comment: created });
  });

  it("gives a friendly message for a 429", async () => {
    apiFetchMock.mockResolvedValue({ status: 429, json: async () => ({}) });
    const outcome = await postComment("p1", "hi");
    expect(outcome).toMatchObject({ ok: false, message: expect.stringMatching(/too fast/i) });
  });

  it("surfaces the server's error message otherwise", async () => {
    apiFetchMock.mockResolvedValue({ status: 403, json: async () => ({ error: { message: "Not entitled." } }) });
    const outcome = await postComment("p1", "hi");
    expect(outcome).toEqual({ ok: false, message: "Not entitled." });
  });

  it("maps a thrown fetch to a connectivity message", async () => {
    apiFetchMock.mockRejectedValue(new Error("offline"));
    const outcome = await postComment("p1", "hi");
    expect(outcome).toMatchObject({ ok: false, message: expect.stringMatching(/couldn.t reach/i) });
  });
});
