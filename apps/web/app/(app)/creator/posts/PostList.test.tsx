import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PostList } from "./PostList";
import type { OwnPost } from "@/lib/post";

const apiFetchMock = vi.fn();
vi.mock("@/lib/apiFetch", () => ({ apiFetch: (...a: unknown[]) => apiFetchMock(...a) }));
vi.mock("@/lib/csrf", () => ({ csrfHeaders: () => ({ "x-csrf-token": "test" }) }));

const toastMock = vi.fn();
vi.mock("@/components/ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/ui")>()),
  toast: (...a: unknown[]) => toastMock(...a),
}));

const user = userEvent.setup({ delay: null });

function post(over: Partial<OwnPost> = {}): OwnPost {
  return {
    id: "p1",
    creatorId: "c1",
    visibility: "SUBSCRIBERS",
    minimumTierId: null,
    text: "a subscriber update",
    media: [],
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

describe("PostList", () => {
  it("shows the empty state with no posts", () => {
    render(<PostList initialPosts={[]} pageAddress="ada.test" />);
    expect(screen.getByText("No posts yet")).toBeInTheDocument();
  });

  it("renders a visibility badge and an edit link per post", () => {
    render(
      <PostList
        initialPosts={[post({ id: "a", visibility: "PUBLIC", text: "hi all" })]}
        pageAddress="ada.test"
      />,
    );
    expect(screen.getByText("Public")).toBeInTheDocument();
    expect(screen.getByText("hi all")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /edit/i })).toHaveAttribute("href", "/creator/posts/a/edit");
  });

  it("deletes a post after confirmation", async () => {
    apiFetchMock.mockResolvedValueOnce({ ok: true, status: 204 });
    render(<PostList initialPosts={[post({ id: "a", text: "goodbye" })]} pageAddress="ada.test" />);

    await user.click(screen.getByRole("button", { name: /delete post/i }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete post" }));

    expect(apiFetchMock).toHaveBeenCalledWith(
      "/creators/me/posts/a",
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(screen.queryByText("goodbye")).not.toBeInTheDocument();
  });
});
