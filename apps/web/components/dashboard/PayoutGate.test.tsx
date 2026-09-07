import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PayoutGate } from "./PayoutGate";

describe("PayoutGate", () => {
  it("renders the real content once payout is VERIFIED", () => {
    render(
      <PayoutGate status="VERIFIED">
        <p>$42.00</p>
      </PayoutGate>,
    );
    expect(screen.getByText("$42.00")).toBeInTheDocument();
    expect(screen.queryByText(/complete payout onboarding/i)).not.toBeInTheDocument();
  });

  it.each([["PENDING"], ["NOT_STARTED"], ["RESTRICTED"], [null], [undefined]] as const)(
    "hides the real content and prompts onboarding when status is %s",
    (status) => {
      render(
        <PayoutGate status={status}>
          <p>$42.00</p>
        </PayoutGate>,
      );
      expect(screen.queryByText("$42.00")).not.toBeInTheDocument();
      expect(screen.getByText(/complete payout onboarding to see earnings/i)).toBeInTheDocument();
      expect(screen.getByRole("link", { name: /complete payout onboarding/i })).toHaveAttribute("href", "/creator/payouts");
    },
  );
});
