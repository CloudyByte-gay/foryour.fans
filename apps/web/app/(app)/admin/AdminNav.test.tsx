import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AdminNav } from "./AdminNav";

const usePathnameMock = vi.fn();
vi.mock("next/navigation", () => ({ usePathname: () => usePathnameMock() }));

describe("AdminNav", () => {
  it("marks the case queue link current on a case detail route", () => {
    usePathnameMock.mockReturnValue("/admin/cases/case_1");
    render(<AdminNav />);
    expect(screen.getByRole("link", { name: /case queue/i })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: /audit log/i })).not.toHaveAttribute("aria-current");
  });

  it("marks the audit log link current on that route", () => {
    usePathnameMock.mockReturnValue("/admin/audit-log");
    render(<AdminNav />);
    expect(screen.getByRole("link", { name: /audit log/i })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: /case queue/i })).not.toHaveAttribute("aria-current");
  });
});
