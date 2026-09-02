import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PostComposer } from "./PostComposer";

const apiFetchMock = vi.fn();
vi.mock("@/lib/apiFetch", () => ({ apiFetch: (...a: unknown[]) => apiFetchMock(...a) }));
vi.mock("@/lib/csrf", () => ({ csrfHeaders: () => ({ "x-csrf-token": "test" }) }));
const toastMock = vi.fn();
vi.mock("@/components/ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/ui")>()),
  toast: (...a: unknown[]) => toastMock(...a),
}));

const user = userEvent.setup({ delay: null });

beforeEach(() => {
  apiFetchMock.mockReset();
  toastMock.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe("PostComposer", () => {
  it("shows the Bluesky publish copy and a character counter for a public post", () => {
    render(<PostComposer tiers={[]} onCreated={() => {}} />);
    expect(screen.getByText(/publishes to bluesky-compatible feeds/i)).toBeInTheDocument();
    expect(screen.getByTestId("grapheme-counter")).toHaveTextContent("0 / 300");
    expect(screen.getByRole("button", { name: /publish post/i })).toHaveTextContent(/bluesky \+ foryour\.fans/i);
  });

  it("swaps to the encrypted / not-on-Bluesky copy for a subscribers post", async () => {
    render(<PostComposer tiers={[]} onCreated={() => {}} />);
    await user.selectOptions(screen.getByRole("combobox"), "SUBSCRIBERS");
    expect(screen.getByText(/is not published as a normal public bluesky post/i)).toBeInTheDocument();
    expect(screen.queryByTestId("grapheme-counter")).not.toBeInTheDocument();
    expect(screen.queryByText(/will appear on bluesky/i)).not.toBeInTheDocument();
  });

  it("disables publish and shows a constraint error when the text can't fit Bluesky rules", async () => {
    render(<PostComposer tiers={[]} onCreated={() => {}} />);
    const textarea = screen.getByRole("textbox", { name: "Post" });
    await user.click(textarea);
    await user.paste("a".repeat(301));
    expect(screen.getByTestId("bsky-problems")).toHaveTextContent(/too long for a bluesky post/i);
    expect(screen.getByRole("button", { name: /publish post/i })).toBeDisabled();
  });

  it("submits a public post and reports the created post", async () => {
    apiFetchMock.mockResolvedValue({
      status: 201,
      json: async () => ({ id: "new", visibility: "PUBLIC", text: "hi", bskyAtUri: "at://x/app.bsky.feed.post/1" }),
    });
    const onCreated = vi.fn();
    render(<PostComposer tiers={[]} onCreated={onCreated} />);
    await user.type(screen.getByRole("textbox", { name: "Post" }), "hello world");
    await user.click(screen.getByRole("button", { name: /publish post/i }));

    expect(apiFetchMock).toHaveBeenCalledWith(
      "/creators/me/posts",
      expect.objectContaining({ method: "POST" }),
    );
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ id: "new" }));
  });
});
