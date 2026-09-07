import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RecentPostsList } from "./RecentPostsList";

describe("RecentPostsList", () => {
  it("shows an empty state with a compose CTA when there are no posts", () => {
    render(<RecentPostsList posts={[]} pageAddress="ada.test" />);
    expect(screen.getByText("No posts yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "New post" })).toHaveAttribute("href", "/creator/posts/new");
  });

  it("renders each post's visibility badge and links to its page", () => {
    render(
      <RecentPostsList
        posts={[
          { id: "p1", visibility: "PUBLIC", text: "hello world", mediaCount: 0, createdAt: new Date().toISOString() },
          { id: "p2", visibility: "TIER", text: "gated content", mediaCount: 2, createdAt: new Date().toISOString() },
        ]}
        pageAddress="ada.test"
      />,
    );
    expect(screen.getByText("Public")).toBeInTheDocument();
    expect(screen.getByText("Specific tier")).toBeInTheDocument();
    expect(screen.getByText("hello world")).toBeInTheDocument();
    const links = screen.getAllByRole("link", { name: "View" });
    expect(links[0]).toHaveAttribute("href", "/c/ada.test/post/p1");
    expect(links[1]).toHaveAttribute("href", "/c/ada.test/post/p2");
  });

  it("truncates a long post body to an excerpt", () => {
    const longText = "x".repeat(200);
    render(
      <RecentPostsList
        posts={[{ id: "p1", visibility: "PUBLIC", text: longText, mediaCount: 0, createdAt: new Date().toISOString() }]}
        pageAddress="ada.test"
      />,
    );
    expect(screen.getByText(/x{140}…/)).toBeInTheDocument();
  });
});
