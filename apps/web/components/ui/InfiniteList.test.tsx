import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { InfiniteList } from "./InfiniteList";

describe("InfiniteList", () => {
  it("shows a Load more button while hasMore is true", () => {
    render(
      <InfiniteList hasMore isLoading={false} onLoadMore={() => {}} auto={false}>
        <p>item</p>
      </InfiniteList>,
    );
    expect(screen.getByRole("button", { name: "Load more" })).toBeInTheDocument();
  });

  it("shows a retry ErrorState when the last page failed", () => {
    render(
      <InfiniteList hasMore isLoading={false} onLoadMore={() => {}} auto={false} error>
        <p>item</p>
      </InfiniteList>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't load more");
  });

  it("announces once a page finishes loading, for screen-reader users who can't see the list grow", () => {
    const { rerender } = render(
      <InfiniteList hasMore isLoading={true} onLoadMore={() => {}} auto={false}>
        <p>item</p>
      </InfiniteList>,
    );
    rerender(
      <InfiniteList hasMore isLoading={false} onLoadMore={() => {}} auto={false}>
        <p>item</p>
      </InfiniteList>,
    );
    expect(screen.getByText("More results loaded.")).toBeInTheDocument();
  });

  it("does not announce a load that ended in an error", () => {
    const { rerender } = render(
      <InfiniteList hasMore isLoading={true} onLoadMore={() => {}} auto={false}>
        <p>item</p>
      </InfiniteList>,
    );
    rerender(
      <InfiniteList hasMore isLoading={false} onLoadMore={() => {}} auto={false} error>
        <p>item</p>
      </InfiniteList>,
    );
    expect(screen.queryByText("More results loaded.")).not.toBeInTheDocument();
  });
});
