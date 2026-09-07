import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DateRangeFilter } from "./DateRangeFilter";

const user = userEvent.setup();

describe("DateRangeFilter", () => {
  it("marks the active preset pressed", () => {
    render(<DateRangeFilter preset="30d" range={{ from: "2026-07-17", to: "2026-08-15" }} onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Last 30 days" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Last 7 days" })).toHaveAttribute("aria-pressed", "false");
  });

  it("clicking a preset calls onChange with that preset's computed range", async () => {
    const onChange = vi.fn();
    render(<DateRangeFilter preset="30d" range={{ from: "2026-07-17", to: "2026-08-15" }} onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Last 7 days" }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const [preset, range] = onChange.mock.calls[0]!;
    expect(preset).toBe("7d");
    expect(range.from <= range.to).toBe(true);
  });

  it("editing the custom start date calls onChange with preset 'custom'", async () => {
    const onChange = vi.fn();
    render(<DateRangeFilter preset="30d" range={{ from: "2026-07-17", to: "2026-08-15" }} onChange={onChange} />);
    const fromInput = screen.getByLabelText("Start date");
    fireEvent.change(fromInput, { target: { value: "2026-08-01" } });
    expect(onChange).toHaveBeenCalledWith("custom", { from: "2026-08-01", to: "2026-08-15" });
  });
});
