import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { EmptyState } from "./EmptyState";
import { ErrorState } from "./ErrorState";

describe("EmptyState", () => {
  it("renders title, description and an action", () => {
    render(<EmptyState title="No tiers yet" description="Create one to get started" action={<button>New tier</button>} />);
    expect(screen.getByText("No tiers yet")).toBeInTheDocument();
    expect(screen.getByText("Create one to get started")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "New tier" })).toBeInTheDocument();
  });
});

describe("ErrorState", () => {
  it("is announced as an alert", () => {
    render(<ErrorState />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("shows a retry button only when onRetry is provided, and calls it", async () => {
    const onRetry = vi.fn();
    const { rerender } = render(<ErrorState />);
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();

    rerender(<ErrorState onRetry={onRetry} />);
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
