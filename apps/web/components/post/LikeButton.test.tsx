import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LikeButton } from "./LikeButton";

const apiFetchMock = vi.fn();
vi.mock("@/lib/apiFetch", () => ({ apiFetch: (...a: unknown[]) => apiFetchMock(...a) }));
vi.mock("@/lib/csrf", () => ({ csrfHeaders: () => ({}) }));

const toastMock = vi.fn();
vi.mock("@/components/ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/ui")>()),
  toast: (...a: unknown[]) => toastMock(...a),
}));

const user = userEvent.setup();

beforeEach(() => {
  apiFetchMock.mockReset();
  toastMock.mockReset();
});

describe("LikeButton", () => {
  it("sends an anonymous viewer to log in, but still shows the count and creator-liked indicator", () => {
    render(
      <LikeButton
        postId="p1"
        isAuthed={false}
        loginNext="/c/ada.test/post/p1"
        isOwner={false}
        creatorName="Ada"
        initialLikeCount={3}
        initialLikedByViewer={false}
        initialLikedByCreator={true}
      />,
    );
    const link = screen.getByRole("link", { name: /3/ });
    expect(link).toHaveAttribute("href", "/login?next=%2Fc%2Fada.test%2Fpost%2Fp1");
    expect(screen.getByText(/Liked by Ada/)).toBeInTheDocument();
    expect(apiFetchMock).not.toHaveBeenCalled();
  });

  it("optimistically toggles on click, then confirms from the server response", async () => {
    apiFetchMock.mockResolvedValue({ ok: true, json: async () => ({ likeCount: 6, likedByViewer: true }) });

    render(
      <LikeButton
        postId="p1"
        isAuthed
        loginNext="/c/ada.test/post/p1"
        isOwner={false}
        creatorName="Ada"
        initialLikeCount={5}
        initialLikedByViewer={false}
        initialLikedByCreator={false}
      />,
    );
    const button = screen.getByRole("button");
    expect(button).toHaveTextContent("5");
    expect(button).toHaveAttribute("aria-pressed", "false");

    await user.click(button);

    expect(apiFetchMock).toHaveBeenCalledWith("/posts/p1/likes", expect.objectContaining({ method: "POST" }));
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(button).toHaveTextContent("6");
  });

  it("unlikes when already liked (DELETE)", async () => {
    apiFetchMock.mockResolvedValue({ ok: true, json: async () => ({ likeCount: 4, likedByViewer: false }) });

    render(
      <LikeButton
        postId="p1"
        isAuthed
        loginNext="/c/ada.test/post/p1"
        isOwner={false}
        creatorName="Ada"
        initialLikeCount={5}
        initialLikedByViewer={true}
        initialLikedByCreator={false}
      />,
    );
    await user.click(screen.getByRole("button"));

    expect(apiFetchMock).toHaveBeenCalledWith("/posts/p1/likes", expect.objectContaining({ method: "DELETE" }));
    expect(screen.getByRole("button")).toHaveTextContent("4");
  });

  it("rolls back the optimistic update and shows a toast on failure", async () => {
    apiFetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: { message: "Server error." } }),
    });

    render(
      <LikeButton
        postId="p1"
        isAuthed
        loginNext="/c/ada.test/post/p1"
        isOwner={false}
        creatorName="Ada"
        initialLikeCount={5}
        initialLikedByViewer={false}
        initialLikedByCreator={false}
      />,
    );
    const button = screen.getByRole("button");
    await user.click(button);

    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(button).toHaveTextContent("5");
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ variant: "error" }));
  });

  it("when the viewer is the creator, liking their own post updates the creator-liked indicator locally", async () => {
    apiFetchMock.mockResolvedValue({ ok: true, json: async () => ({ likeCount: 1, likedByViewer: true }) });

    render(
      <LikeButton
        postId="p1"
        isAuthed
        loginNext="/c/ada.test/post/p1"
        isOwner
        creatorName="Ada"
        initialLikeCount={0}
        initialLikedByViewer={false}
        initialLikedByCreator={false}
      />,
    );
    await user.click(screen.getByRole("button"));

    // The owner's own toggle doesn't show a redundant "Liked by Ada" next to their own button.
    expect(screen.queryByText(/Liked by Ada/)).not.toBeInTheDocument();
  });
});
