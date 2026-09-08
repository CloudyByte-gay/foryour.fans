import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import RouteError from "./RouteError";

describe("RouteError", () => {
  it("renders an alert with a retry button wired to reset()", async () => {
    const reset = vi.fn();
    render(<RouteError error={new Error("boom")} reset={reset} />);

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Couldn't load this page")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reset).toHaveBeenCalledOnce();
  });

  it("logs the error for whatever logging is wired up", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new Error("boom");
    render(<RouteError error={error} reset={() => {}} />);
    expect(consoleError).toHaveBeenCalledWith(error);
    consoleError.mockRestore();
  });
});
