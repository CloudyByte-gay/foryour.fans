import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ModerationNoticesBanner, type ModerationNotice } from "./ModerationNoticesBanner";

const REMOVED_POST: ModerationNotice = {
  targetType: "POST",
  targetId: "post-1",
  reason: "spam",
  removedAt: "2026-01-01T00:00:00.000Z",
};

const REMOVED_COMMENT: ModerationNotice = {
  targetType: "COMMENT",
  targetId: "comment-1",
  reason: null,
  removedAt: "2026-01-02T00:00:00.000Z",
};

describe("ModerationNoticesBanner", () => {
  it("renders nothing when there are no notices", () => {
    render(<ModerationNoticesBanner notices={[]} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows a post-removal notice with its reason", () => {
    render(<ModerationNoticesBanner notices={[REMOVED_POST]} />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/a post you published was removed by a moderator/i);
    expect(alert).toHaveTextContent(/reason given: spam/i);
  });

  it("shows a comment-removal notice with no reason given", () => {
    render(<ModerationNoticesBanner notices={[REMOVED_COMMENT]} />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/a comment you wrote was removed by a moderator/i);
    expect(alert).toHaveTextContent(/no reason was given/i);
  });

  it("renders one alert per notice and disables the appeal placeholder", () => {
    render(<ModerationNoticesBanner notices={[REMOVED_POST, REMOVED_COMMENT]} />);
    expect(screen.getAllByRole("alert")).toHaveLength(2);
    for (const button of screen.getAllByRole("button", { name: /appeal/i })) {
      expect(button).toBeDisabled();
    }
  });
});
