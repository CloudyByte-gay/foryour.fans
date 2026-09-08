import { render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RouteFocusManager } from "./RouteFocusManager";

const usePathnameMock = vi.fn();
vi.mock("next/navigation", () => ({ usePathname: () => usePathnameMock() }));

describe("RouteFocusManager", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("does not move focus on initial mount", () => {
    usePathnameMock.mockReturnValue("/feed");
    const main = document.createElement("main");
    main.id = "main-content";
    main.tabIndex = -1;
    document.body.appendChild(main);
    const input = document.createElement("input");
    document.body.appendChild(input);
    input.focus();

    render(<RouteFocusManager />);

    expect(document.activeElement).toBe(input);
  });

  it("moves focus to #main-content when the pathname changes", () => {
    usePathnameMock.mockReturnValue("/feed");
    const main = document.createElement("main");
    main.id = "main-content";
    main.tabIndex = -1;
    document.body.appendChild(main);

    const { rerender } = render(<RouteFocusManager />);
    expect(document.activeElement).not.toBe(main);

    usePathnameMock.mockReturnValue("/discover");
    rerender(<RouteFocusManager />);

    expect(document.activeElement).toBe(main);
  });

  it("does not steal focus from a field the new route already autofocused", () => {
    usePathnameMock.mockReturnValue("/feed");
    const main = document.createElement("main");
    main.id = "main-content";
    main.tabIndex = -1;
    document.body.appendChild(main);

    const { rerender } = render(<RouteFocusManager />);

    // Simulate the new route's own autofocused field claiming focus
    // synchronously, before this component's effect runs on the next render.
    const composerField = document.createElement("textarea");
    document.body.appendChild(composerField);
    composerField.focus();

    usePathnameMock.mockReturnValue("/creator/posts/new");
    rerender(<RouteFocusManager />);

    expect(document.activeElement).toBe(composerField);
  });
});
