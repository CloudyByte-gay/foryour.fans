import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  ArticleRouteLoading,
  AuthRouteLoading,
  FormRouteLoading,
  GridRouteLoading,
  ListRouteLoading,
  ProfileRouteLoading,
} from "./RouteLoading";

const VARIANTS = [
  ["FormRouteLoading", FormRouteLoading],
  ["ListRouteLoading", ListRouteLoading],
  ["ProfileRouteLoading", ProfileRouteLoading],
  ["ArticleRouteLoading", ArticleRouteLoading],
  ["GridRouteLoading", GridRouteLoading],
  ["AuthRouteLoading", AuthRouteLoading],
] as const;

describe.each(VARIANTS)("%s", (_name, Component) => {
  it("announces itself as a busy, polite status region for screen readers", () => {
    render(<Component />);
    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("aria-busy", "true");
    expect(region).toHaveTextContent("Loading…");
  });
});
