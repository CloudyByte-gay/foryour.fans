import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchPostLikes, likePost, unlikePost } from "./likes";

const apiFetchMock = vi.fn();
vi.mock("@/lib/apiFetch", () => ({ apiFetch: (...a: unknown[]) => apiFetchMock(...a) }));
vi.mock("@/lib/csrf", () => ({ csrfHeaders: () => ({ "x-csrf-token": "test" }) }));

afterEach(() => {
  apiFetchMock.mockReset();
});

describe("likePost", () => {
  it("POSTs and returns the new state", async () => {
    apiFetchMock.mockResolvedValue({ ok: true, json: async () => ({ likeCount: 3, likedByViewer: true }) });
    const outcome = await likePost("p1");
    expect(apiFetchMock).toHaveBeenCalledWith("/posts/p1/likes", expect.objectContaining({ method: "POST" }));
    expect(outcome).toEqual({ ok: true, likeCount: 3, likedByViewer: true });
  });

  it("gives a friendly message for a 429", async () => {
    apiFetchMock.mockResolvedValue({ ok: false, status: 429, json: async () => ({}) });
    const outcome = await likePost("p1");
    expect(outcome).toMatchObject({ ok: false, message: expect.stringMatching(/too fast/i) });
  });

  it("maps a thrown fetch to a connectivity message", async () => {
    apiFetchMock.mockRejectedValue(new Error("offline"));
    const outcome = await likePost("p1");
    expect(outcome).toMatchObject({ ok: false, message: expect.stringMatching(/couldn.t reach/i) });
  });
});

describe("unlikePost", () => {
  it("DELETEs and returns the new state", async () => {
    apiFetchMock.mockResolvedValue({ ok: true, json: async () => ({ likeCount: 2, likedByViewer: false }) });
    const outcome = await unlikePost("p1");
    expect(apiFetchMock).toHaveBeenCalledWith("/posts/p1/likes", expect.objectContaining({ method: "DELETE" }));
    expect(outcome).toEqual({ ok: true, likeCount: 2, likedByViewer: false });
  });

  it("surfaces the server's error message otherwise", async () => {
    apiFetchMock.mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: { message: "Not entitled." } }) });
    const outcome = await unlikePost("p1");
    expect(outcome).toEqual({ ok: false, message: "Not entitled." });
  });
});

describe("fetchPostLikes", () => {
  it("requests the first page and maps the payload", async () => {
    apiFetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ likes: [{ actor: { did: "did:plc:a", handle: "a.test", displayName: null, avatarUrl: null }, createdAt: "2026-09-10T00:00:00Z" }], nextCursor: "c2" }),
    });
    const page = await fetchPostLikes("p1");
    expect(apiFetchMock).toHaveBeenCalledWith("/posts/p1/likes?limit=30");
    expect(page.likes[0]!.actor.handle).toBe("a.test");
    expect(page.nextCursor).toBe("c2");
  });

  it("passes a cursor when given", async () => {
    apiFetchMock.mockResolvedValue({ ok: true, json: async () => ({ likes: [], nextCursor: null }) });
    await fetchPostLikes("p1", "abc=");
    expect(apiFetchMock).toHaveBeenCalledWith("/posts/p1/likes?limit=30&cursor=abc%3D");
  });

  it("throws on a non-OK response so callers can fall back to an empty page", async () => {
    apiFetchMock.mockResolvedValue({ ok: false, status: 403, json: async () => ({}) });
    await expect(fetchPostLikes("p1")).rejects.toThrow();
  });
});
