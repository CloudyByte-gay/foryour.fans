import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ThemeProvider } from "@/components/providers/ThemeProvider";
import { AppearanceTab } from "./AppearanceTab";

const user = userEvent.setup();

beforeEach(() => {
  document.documentElement.classList.remove("dark");
  document.cookie = "ff_theme=; max-age=0; path=/";
});

afterEach(() => {
  document.documentElement.classList.remove("dark");
});

function renderWithTheme() {
  return render(
    <ThemeProvider initialPreference="system">
      <AppearanceTab />
    </ThemeProvider>,
  );
}

describe("AppearanceTab", () => {
  it("renders the three theme options with System selected", () => {
    renderWithTheme();
    expect(screen.getByRole("radio", { name: "System" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Light" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("radio", { name: "Dark" })).toHaveAttribute("aria-checked", "false");
  });

  it("applies the dark theme and persists the choice when Dark is picked", async () => {
    renderWithTheme();
    await user.click(screen.getByRole("radio", { name: "Dark" }));

    expect(screen.getByRole("radio", { name: "Dark" })).toHaveAttribute("aria-checked", "true");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.cookie).toContain("ff_theme=dark");
  });
});
