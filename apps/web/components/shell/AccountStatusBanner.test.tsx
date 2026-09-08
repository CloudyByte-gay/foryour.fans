import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AccountStatusBanner } from "./AccountStatusBanner";
import type { SessionUser } from "@/lib/session";

const ACTIVE_USER: SessionUser = {
  did: "did:plc:u1",
  handle: "alice.bsky.social",
  displayName: "Alice",
  avatarUrl: null,
  bannerUrl: null,
  role: "USER",
  status: "ACTIVE",
};

describe("AccountStatusBanner", () => {
  it("renders nothing for an active user with no creator account", () => {
    render(<AccountStatusBanner user={ACTIVE_USER} creator={null} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders nothing for an active user with an active creator account", () => {
    render(
      <AccountStatusBanner
        user={ACTIVE_USER}
        creator={{ did: "did:plc:u1", handle: "alice", status: "ACTIVE" }}
      />,
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows a restricted-account banner when the user is restricted", () => {
    render(<AccountStatusBanner user={{ ...ACTIVE_USER, status: "RESTRICTED" }} creator={null} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/your account is restricted/i);
  });

  it("shows a suspended-creator banner when the creator account is suspended", () => {
    render(
      <AccountStatusBanner
        user={ACTIVE_USER}
        creator={{ did: "did:plc:u1", handle: "alice", status: "SUSPENDED" }}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/your creator account is suspended/i);
  });

  it("prefers the restricted-user banner when both apply", () => {
    render(
      <AccountStatusBanner
        user={{ ...ACTIVE_USER, status: "RESTRICTED" }}
        creator={{ did: "did:plc:u1", handle: "alice", status: "SUSPENDED" }}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(/your account is restricted/i);
  });
});
