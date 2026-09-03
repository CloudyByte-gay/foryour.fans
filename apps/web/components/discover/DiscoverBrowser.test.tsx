import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DiscoverBrowser } from "./DiscoverBrowser";
import { apiFetch } from "@/lib/apiFetch";
import type { DiscoveryCreator, DiscoveryPage } from "@/lib/discover";

vi.mock("@/lib/apiFetch", () => ({ apiFetch: vi.fn() }));

function creator(overrides: Partial<DiscoveryCreator> = {}): DiscoveryCreator {
  return {
    did: "did:plc:abc",
    handle: "alice.test",
    displayName: "Alice",
    bio: "hello",
    website: null,
    isRegisteredCreator: true,
    avatarUrl: null,
    tierCount: 1,
    fromPriceCents: 500,
    fromPriceCurrency: "usd",
    ...overrides,
  };
}

function jsonResponse(body: DiscoveryPage): Response {
  return { ok: true, json: async () => body } as unknown as Response;
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.mocked(apiFetch).mockReset();
});

describe("DiscoverBrowser", () => {
  it("renders the seeded first page without an extra fetch", () => {
    render(<DiscoverBrowser initialQuery="" initialPage={{ creators: [creator()], nextCursor: null }} />);
    expect(screen.getByRole("link", { name: "Alice" })).toBeInTheDocument();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("shows an empty state when there are no creators", () => {
    render(<DiscoverBrowser initialQuery="" initialPage={{ creators: [], nextCursor: null }} />);
    expect(screen.getByText("No creators yet")).toBeInTheDocument();
  });

  it("debounces typing and re-fetches via /search, showing a no-results state and recording a recent search", async () => {
    const user = userEvent.setup();
    vi.mocked(apiFetch).mockResolvedValue(jsonResponse({ creators: [], nextCursor: null }));

    render(<DiscoverBrowser initialQuery="" initialPage={{ creators: [creator()], nextCursor: null }} />);
    await user.type(screen.getByLabelText("Search creators"), "zzz-no-match");

    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith(expect.stringContaining("/search?")));
    await waitFor(() => expect(screen.getByText(/no creators found/i)).toBeInTheDocument());
    expect(screen.getByText(/zzz-no-match/)).toBeInTheDocument();

    expect(JSON.parse(window.localStorage.getItem("ff_recent_searches") ?? "[]")).toContain("zzz-no-match");
  });

  it("loads more results via the cursor and appends them", async () => {
    const user = userEvent.setup();
    const second = creator({ did: "did:plc:second", handle: "bob.test", displayName: "Bob" });
    vi.mocked(apiFetch).mockResolvedValue(jsonResponse({ creators: [second], nextCursor: null }));

    render(
      <DiscoverBrowser
        initialQuery=""
        initialPage={{ creators: [creator()], nextCursor: "did:plc:abc" }}
      />,
    );

    await user.click(screen.getByRole("button", { name: /load more/i }));

    await waitFor(() => expect(screen.getByRole("link", { name: "Bob" })).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "Alice" })).toBeInTheDocument();
  });
});
