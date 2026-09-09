import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Comment, CommentsPage } from "@/lib/comments";
import { CommentThread } from "./CommentThread";

const apiFetchMock = vi.fn();
vi.mock("@/lib/apiFetch", () => ({ apiFetch: (...a: unknown[]) => apiFetchMock(...a) }));
vi.mock("@/lib/csrf", () => ({ csrfHeaders: () => ({}) }));

const toastMock = vi.fn();
vi.mock("@/components/ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/ui")>()),
  toast: (...a: unknown[]) => toastMock(...a),
}));

const user = userEvent.setup({ delay: null });

function comment(over: Partial<Comment> = {}): Comment {
  return {
    id: "c1",
    postId: "p1",
    text: "hello!",
    createdAt: "2026-01-01T00:00:00.000Z",
    author: { did: "did:plc:sub", handle: "sam.test", displayName: "Sam", avatarUrl: null },
    ...over,
  };
}

const emptyPage: CommentsPage = { comments: [], nextCursor: null };

beforeEach(() => {
  apiFetchMock.mockReset();
  toastMock.mockReset();
});

describe("CommentThread", () => {
  it("badges the post creator's own comment", () => {
    render(
      <CommentThread
        postId="p1"
        initialPage={{ comments: [comment({ author: { did: "did:plc:creator", handle: "ada.test", displayName: "Ada", avatarUrl: null } })], nextCursor: null }}
        creatorDid="did:plc:creator"
        isAuthed
        loginNext="/c/ada.test/post/p1"
        viewerDid="did:plc:sub"
        viewerName="Sam"
        viewerAvatarUrl={null}
      />,
    );
    expect(screen.getByText("Ada")).toBeInTheDocument();
    expect(screen.getByText("Creator")).toBeInTheDocument();
  });

  it("shows an empty state and no composer for an anonymous viewer", () => {
    render(
      <CommentThread
        postId="p1"
        initialPage={emptyPage}
        creatorDid="did:plc:creator"
        isAuthed={false}
        loginNext="/c/ada.test/post/p1"
        viewerDid={null}
        viewerName={null}
        viewerAvatarUrl={null}
      />,
    );
    expect(screen.getByText(/no comments yet/i)).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /log in/i })).toHaveAttribute(
      "href",
      "/login?next=%2Fc%2Fada.test%2Fpost%2Fp1",
    );
  });

  it("posts a comment and appends it to the thread", async () => {
    apiFetchMock.mockResolvedValueOnce({
      status: 201,
      json: async () => comment({ id: "c2", text: "great post" }),
    });

    render(
      <CommentThread
        postId="p1"
        initialPage={emptyPage}
        creatorDid="did:plc:creator"
        isAuthed
        loginNext="/c/ada.test/post/p1"
        viewerDid="did:plc:sub"
        viewerName="Sam"
        viewerAvatarUrl={null}
      />,
    );

    await user.type(screen.getByRole("textbox", { name: /add a comment/i }), "great post");
    await user.click(screen.getByRole("button", { name: /^comment$/i }));

    expect(apiFetchMock).toHaveBeenCalledWith(
      "/posts/p1/comments",
      expect.objectContaining({ method: "POST" }),
    );
    expect(await screen.findByText("great post")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /add a comment/i })).toHaveValue("");
  });

  it("loads the next page and appends it below the first", async () => {
    apiFetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ comments: [comment({ id: "c2", text: "second page" })], nextCursor: null }),
    });

    render(
      <CommentThread
        postId="p1"
        initialPage={{ comments: [comment({ text: "first page" })], nextCursor: "c1" }}
        creatorDid="did:plc:creator"
        isAuthed
        loginNext="/c/ada.test/post/p1"
        viewerDid="did:plc:sub"
        viewerName="Sam"
        viewerAvatarUrl={null}
      />,
    );

    expect(screen.getByText("first page")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /load more/i }));

    expect(apiFetchMock).toHaveBeenCalledWith("/posts/p1/comments?limit=20&cursor=c1");
    expect(await screen.findByText("second page")).toBeInTheDocument();
    expect(screen.getByText("first page")).toBeInTheDocument();
  });

  it("hides the actions menu on the viewer's own comment", () => {
    render(
      <CommentThread
        postId="p1"
        initialPage={{ comments: [comment()], nextCursor: null }}
        creatorDid="did:plc:creator"
        isAuthed
        loginNext="/c/ada.test/post/p1"
        viewerDid="did:plc:sub"
        viewerName="Sam"
        viewerAvatarUrl={null}
      />,
    );
    expect(screen.queryByRole("button", { name: /actions for comment by sam/i })).not.toBeInTheDocument();
  });

  // Radix's DropdownMenu is observed to run its open/close+animation-presence
  // logic very slowly (tens of real seconds, not a hang — see git history for
  // this file) under this project's jsdom + vitest setup; not reproduced with
  // Dialog-only interactions elsewhere (e.g. TierFormDialog.test.tsx). These
  // two tests use fireEvent (a raw DOM dispatch, skipping userEvent's
  // realistic-but-heavier pointer simulation) for the DropdownMenu open step
  // specifically, and a generous timeout, rather than leaving this
  // Comments-thread coverage out.
  it("files a real report through the actions menu", { timeout: 90_000 }, async () => {
    apiFetchMock.mockResolvedValueOnce({ status: 201, json: async () => ({ id: "r1" }) });

    render(
      <CommentThread
        postId="p1"
        initialPage={{ comments: [comment()], nextCursor: null }}
        creatorDid="did:plc:creator"
        isAuthed
        loginNext="/c/ada.test/post/p1"
        viewerDid="did:plc:viewer"
        viewerName="Vic"
        viewerAvatarUrl={null}
      />,
    );

    const trigger = screen.getByRole("button", { name: /actions for comment by sam/i });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: /report comment/i }));
    fireEvent.click(screen.getByRole("button", { name: /submit report/i }));

    await vi.waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: expect.stringMatching(/report filed/i) })),
    );
    expect(apiFetchMock).toHaveBeenCalledWith(
      "/reports",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ subjectType: "COMMENT", subjectId: "c1", reasonType: "SPAM" }),
      }),
    );
  });

  it("blocks the comment's author through the actions menu", { timeout: 90_000 }, async () => {
    apiFetchMock.mockResolvedValueOnce({ status: 201, json: async () => ({ blockedUserId: "u1", createdAt: "2026-01-01T00:00:00.000Z" }) });

    render(
      <CommentThread
        postId="p1"
        initialPage={{ comments: [comment()], nextCursor: null }}
        creatorDid="did:plc:creator"
        isAuthed
        loginNext="/c/ada.test/post/p1"
        viewerDid="did:plc:viewer"
        viewerName="Vic"
        viewerAvatarUrl={null}
      />,
    );

    const trigger = screen.getByRole("button", { name: /actions for comment by sam/i });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: /block sam/i }));
    fireEvent.click(screen.getByRole("button", { name: /^block$/i }));

    await vi.waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith(
        "/blocks",
        expect.objectContaining({ method: "POST", body: JSON.stringify({ identifier: "did:plc:sub" }) }),
      ),
    );
  });
});
