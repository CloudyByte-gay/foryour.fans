import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LoginForm } from "./LoginForm";

const user = userEvent.setup({ delay: null });

const originalFetch = global.fetch;

beforeEach(() => {
  // jsdom has no real navigation; make href assignable so onSubmit doesn't throw.
  Object.defineProperty(window, "location", {
    value: { href: "", pathname: "/login", search: "" },
    writable: true,
  });
  window.sessionStorage.clear();
});

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("LoginForm", () => {
  it("validates that a handle was entered", async () => {
    render(<LoginForm />);
    await user.click(screen.getByRole("button", { name: /continue with at protocol/i }));
    expect(await screen.findByText(/enter your at protocol handle/i)).toBeInTheDocument();
  });

  it("rejects a malformed handle before calling the API", async () => {
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    render(<LoginForm />);
    await user.type(screen.getByLabelText(/at protocol handle/i), "notahandle");
    await user.click(screen.getByRole("button", { name: /continue with at protocol/i }));

    expect(await screen.findByText(/doesn't look like a handle/i)).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("surfaces a start failure with an actionable message and stores `next`", async () => {
    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: { message: "Could not start sign-in for that handle." } }),
    })) as unknown as typeof fetch;

    render(<LoginForm next="/c/alice" />);
    await user.type(screen.getByLabelText(/at protocol handle/i), "alice.bsky.social");
    await user.click(screen.getByRole("button", { name: /continue with at protocol/i }));

    expect(await screen.findByText(/couldn't start sign-in for @alice\.bsky\.social/i)).toBeInTheDocument();
    expect(window.sessionStorage.getItem("ff.postLoginNext")).toBe("/c/alice");
  });

  it("redirects to the authorization server on a successful start", async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ redirectUrl: "https://pds.example/oauth/authorize?x=1" }),
    })) as unknown as typeof fetch;

    render(<LoginForm />);
    await user.type(screen.getByLabelText(/at protocol handle/i), "alice.bsky.social");
    await user.click(screen.getByRole("button", { name: /continue with at protocol/i }));

    await vi.waitFor(() => {
      expect(window.location.href).toBe("https://pds.example/oauth/authorize?x=1");
    });
  });
});
