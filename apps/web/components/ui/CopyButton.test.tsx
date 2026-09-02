import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CopyButton } from "./CopyButton";

const user = userEvent.setup();

function stubClipboard(writeText: () => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
}

afterEach(() => vi.restoreAllMocks());

describe("CopyButton", () => {
  it("writes the value to the clipboard and confirms", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);

    render(<CopyButton value="did:plc:abc123" label="Copy DID" />);
    await user.click(screen.getByRole("button", { name: "Copy DID" }));

    expect(writeText).toHaveBeenCalledWith("did:plc:abc123");
    expect(await screen.findByRole("button", { name: /copied/i })).toBeInTheDocument();
  });

  it("stays usable if the clipboard API rejects", async () => {
    stubClipboard(vi.fn().mockRejectedValue(new Error("blocked")));

    render(<CopyButton value="x" label="Copy DID" />);
    await user.click(screen.getByRole("button", { name: "Copy DID" }));

    expect(screen.getByRole("button", { name: "Copy DID" })).toBeInTheDocument();
  });
});
