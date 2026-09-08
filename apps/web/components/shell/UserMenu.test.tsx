import { render, screen } from "@testing-library/react";
import { fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { UserMenu } from "./UserMenu";
import type { SessionUser } from "@/lib/session";

vi.mock("@/lib/auth", () => ({ logout: vi.fn() }));

const USER: SessionUser = {
  did: "did:plc:u1",
  handle: "alice.bsky.social",
  displayName: "Alice",
  avatarUrl: null,
  bannerUrl: null,
  role: "USER",
  status: "ACTIVE",
};

// Radix DropdownMenu doesn't open on a plain click under jsdom — focus +
// Enter is the reliable way to trigger it here (see CommentThread.test.tsx).
function openMenu(trigger: HTMLElement) {
  trigger.focus();
  fireEvent.keyDown(trigger, { key: "Enter" });
}

describe("UserMenu", () => {
  it("hides the Admin entry for a non-admin user", { timeout: 45_000 }, () => {
    render(<UserMenu user={USER} isCreator={false} />);
    openMenu(screen.getByRole("button", { name: /account menu/i }));
    expect(screen.queryByRole("menuitem", { name: /admin/i })).not.toBeInTheDocument();
  });

  it("shows the Admin entry linking to /admin for an admin user", { timeout: 45_000 }, () => {
    render(<UserMenu user={{ ...USER, role: "ADMIN" }} isCreator={false} />);
    openMenu(screen.getByRole("button", { name: /account menu/i }));
    expect(screen.getByRole("menuitem", { name: /admin/i })).toHaveAttribute("href", "/admin");
  });
});
