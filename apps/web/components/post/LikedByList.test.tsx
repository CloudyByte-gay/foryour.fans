import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LikedByList } from "./LikedByList";
import type { PostLikesPage } from "@/lib/likes";

const fetchPostLikesMock = vi.fn();
vi.mock("@/lib/likes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/likes")>()),
  fetchPostLikes: (...a: unknown[]) => fetchPostLikesMock(...a),
}));

const user = userEvent.setup();

beforeEach(() => {
  fetchPostLikesMock.mockReset();
});

function page(over: Partial<PostLikesPage> = {}): PostLikesPage {
  return {
    likes: [
      { actor: { did: "did:plc:a", handle: "ada.test", displayName: "Ada", avatarUrl: null }, createdAt: "2026-09-10T00:00:00Z" },
    ],
    nextCursor: null,
    ...over,
  };
}

describe("LikedByList", () => {
  it("renders nothing when there are no likes", () => {
    const { container } = render(<LikedByList postId="p1" initialPage={{ likes: [], nextCursor: null }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows a collapsed 'Liked by N' summary and expands on click", async () => {
    render(<LikedByList postId="p1" initialPage={page()} />);
    const toggle = screen.getByRole("button", { name: /liked by 1/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Ada")).not.toBeInTheDocument();

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Ada")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Ada/ })).toHaveAttribute("href", "/c/ada.test");
  });

  it("uses an 'N+' summary while more pages remain and appends the next page", async () => {
    fetchPostLikesMock.mockResolvedValue({
      likes: [{ actor: { did: "did:plc:b", handle: "bo.test", displayName: "Bo", avatarUrl: null }, createdAt: "2026-09-09T00:00:00Z" }],
      nextCursor: null,
    });
    render(<LikedByList postId="p1" initialPage={page({ nextCursor: "c2" })} />);
    expect(screen.getByRole("button", { name: /liked by 1\+/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /liked by/i }));
    await user.click(screen.getByRole("button", { name: /load more/i }));

    expect(fetchPostLikesMock).toHaveBeenCalledWith("p1", "c2");
    expect(await screen.findByText("Bo")).toBeInTheDocument();
  });
});
