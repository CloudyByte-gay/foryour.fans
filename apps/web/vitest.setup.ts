import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});

// jsdom doesn't implement ResizeObserver; some Radix primitives (Switch, …)
// use it on mount.
if (typeof globalThis !== "undefined" && !("ResizeObserver" in globalThis)) {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub;
}

// jsdom doesn't implement IntersectionObserver; InfiniteList (used by
// DiscoverBrowser, WEB PHASE 10) uses it for scroll-triggered "load more".
if (typeof globalThis !== "undefined" && !("IntersectionObserver" in globalThis)) {
  class IntersectionObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = IntersectionObserverStub;
}

// jsdom doesn't implement matchMedia; ThemeProvider (and anything theme-aware)
// calls it on mount.
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

// jsdom implements neither the Pointer Capture API nor scrollIntoView —
// Radix's DropdownMenu/Select (Popper + roving-focus internals) call these
// on open, and without a stub `userEvent.click`ing a trigger hangs until the
// test's own timeout rather than failing fast (WEB PHASE 14, first phase to
// exercise DropdownMenu in a component test — see CommentThread.test.tsx /
// PostArticle.test.tsx).
if (typeof Element !== "undefined") {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => {};
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {};
  }
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
}
