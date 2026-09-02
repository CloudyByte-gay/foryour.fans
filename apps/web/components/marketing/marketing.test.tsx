import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { SessionUser } from "@/lib/session";
import { Hero } from "./Hero";
import { LegalPage } from "./LegalPage";
import { PersonalizedPanel } from "./PersonalizedPanel";
import { FeaturedCreators } from "./Sections";

const user: SessionUser = {
  did: "did:plc:abc",
  handle: "ada.example",
  displayName: "Ada Lovelace",
  avatarUrl: null,
};

describe("Hero", () => {
  it("shows both CTAs pointing at login and creator onboarding", () => {
    render(<Hero />);
    expect(screen.getByRole("link", { name: "Continue with AT Protocol" })).toHaveAttribute(
      "href",
      "/login",
    );
    expect(screen.getByRole("link", { name: "Become a creator" })).toHaveAttribute(
      "href",
      "/become-a-creator",
    );
  });
});

describe("PersonalizedPanel", () => {
  it("greets the user and, for a non-creator, links to onboarding", () => {
    render(<PersonalizedPanel user={user} isCreator={false} />);
    expect(screen.getByRole("heading", { name: /Welcome back, Ada Lovelace/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Become a creator/ })).toHaveAttribute(
      "href",
      "/become-a-creator",
    );
    expect(screen.queryByRole("link", { name: /Creator dashboard/ })).not.toBeInTheDocument();
  });

  it("links a creator to their dashboard instead", () => {
    render(<PersonalizedPanel user={user} isCreator />);
    expect(screen.getByRole("link", { name: /Creator dashboard/ })).toHaveAttribute(
      "href",
      "/creator/dashboard",
    );
  });

  it("falls back to the handle, then a generic greeting", () => {
    render(<PersonalizedPanel user={{ ...user, displayName: null }} isCreator={false} />);
    expect(screen.getByRole("heading", { name: /Welcome back, ada.example/ })).toBeInTheDocument();
  });
});

describe("FeaturedCreators", () => {
  it("renders an empty state and does not invent creators", () => {
    render(<FeaturedCreators />);
    expect(screen.getByText(/coming soon/i)).toBeInTheDocument();
  });
});

describe("LegalPage", () => {
  it("always carries a pending-legal-review note", () => {
    render(
      <LegalPage
        title="Terms of Service"
        intro="intro copy"
        lastUpdated="September 2026"
        sections={[{ heading: "A section", body: "body copy" }]}
      />,
    );
    expect(screen.getByRole("note")).toHaveTextContent(/pending legal review/i);
    expect(screen.getByRole("heading", { name: "A section" })).toBeInTheDocument();
  });
});
