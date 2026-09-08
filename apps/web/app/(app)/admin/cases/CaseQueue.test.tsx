import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CaseQueue } from "./CaseQueue";

const apiFetchMock = vi.fn();
vi.mock("@/lib/apiFetch", () => ({ apiFetch: (...a: unknown[]) => apiFetchMock(...a) }));

const user = userEvent.setup();

const CASE_1 = {
  id: "case_1",
  subjectType: "POST",
  subjectId: "post_1",
  status: "OPEN",
  requiresLegalReview: false,
  classifierSuggestion: null,
  openedAt: "2026-01-01T00:00:00.000Z",
  resolvedAt: null,
  resolvedByUserId: null,
  resolutionNote: null,
};

beforeEach(() => {
  apiFetchMock.mockReset();
});

describe("CaseQueue", () => {
  it("loads the OPEN queue by default and shows a case", async () => {
    apiFetchMock.mockResolvedValue({ ok: true, json: async () => [CASE_1] });
    render(<CaseQueue />);

    await waitFor(() => expect(screen.getByRole("link", { name: /post/i })).toBeInTheDocument());
    expect(apiFetchMock).toHaveBeenCalledWith("/admin/cases?status=OPEN");
    expect(screen.getByText("post_1")).toBeInTheDocument();
  });

  it("shows an empty state when there are no matching cases", async () => {
    apiFetchMock.mockResolvedValue({ ok: true, json: async () => [] });
    render(<CaseQueue />);
    await waitFor(() => expect(screen.getByText(/no cases match/i)).toBeInTheDocument());
  });

  it("shows an error state with retry on failure", async () => {
    apiFetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    render(<CaseQueue />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());

    apiFetchMock.mockResolvedValue({ ok: true, json: async () => [CASE_1] });
    await user.click(screen.getByRole("button", { name: /try again/i }));
    await waitFor(() => expect(screen.getByText("post_1")).toBeInTheDocument());
  });

  it("re-fetches with the requiresLegalReview filter", async () => {
    apiFetchMock.mockResolvedValue({ ok: true, json: async () => [] });
    render(<CaseQueue />);
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledWith("/admin/cases?status=OPEN"));

    await user.click(screen.getByLabelText(/requires legal review only/i));
    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith("/admin/cases?status=OPEN&requiresLegalReview=true"),
    );
  });
});
