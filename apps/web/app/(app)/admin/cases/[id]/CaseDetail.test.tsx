import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CaseDetail } from "./CaseDetail";

const apiFetchMock = vi.fn();
vi.mock("@/lib/apiFetch", () => ({ apiFetch: (...a: unknown[]) => apiFetchMock(...a) }));
vi.mock("@/lib/csrf", () => ({ csrfHeaders: () => ({}) }));

const toastMock = vi.fn();
vi.mock("@/components/ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/ui")>()),
  toast: (...a: unknown[]) => toastMock(...a),
}));

const user = userEvent.setup();

const POST_CASE = {
  id: "case_1",
  subjectType: "POST",
  subjectId: "post_1",
  status: "OPEN",
  requiresLegalReview: false,
  classifierSuggestion: { severity: "high", suggestedLabels: ["porn"] },
  openedAt: "2026-01-01T00:00:00.000Z",
  resolvedAt: null,
  resolvedByUserId: null,
  resolutionNote: null,
  reports: [
    {
      id: "report_1",
      reasonType: "SEXUAL_CONTENT_VIOLATION",
      reason: "this violates the rules",
      createdAt: "2026-01-01T00:00:00.000Z",
      reporter: { id: "u1", did: "did:plc:reporter", handle: "reporter" },
    },
  ],
  labels: [{ id: "label_1", subjectType: "POST", subjectId: "post_1", subjectUri: null, val: "porn", src: "moderator", neg: false, cts: "2026-01-01T00:00:00.000Z", exp: null }],
  auditLogs: [],
};

beforeEach(() => {
  apiFetchMock.mockReset();
  toastMock.mockReset();
});

describe("CaseDetail", () => {
  it("shows a not-found state for a missing case", async () => {
    apiFetchMock.mockResolvedValue({ ok: false, status: 404, json: async () => ({}) });
    render(<CaseDetail caseId="missing" />);
    await waitFor(() => expect(screen.getByText(/case not found/i)).toBeInTheDocument());
  });

  it("shows an error state on a fetch failure", async () => {
    apiFetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    render(<CaseDetail caseId="case_1" />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
  });

  it("renders the case's reports, labels, and classifier signal, and offers the POST-specific action", async () => {
    apiFetchMock.mockResolvedValue({ ok: true, json: async () => POST_CASE });
    render(<CaseDetail caseId="case_1" />);

    await waitFor(() => expect(screen.getByText("this violates the rules")).toBeInTheDocument());
    expect(screen.getByText(/reported by @reporter/i)).toBeInTheDocument();
    expect(screen.getByText(/"severity": "high"/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /remove post/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /suspend creator/i })).not.toBeInTheDocument();
  });

  it("requires a reason before allowing content removal, and removes the post on submit", async () => {
    apiFetchMock.mockImplementation(async (path: string) => {
      if (path === "/admin/cases/case_1") return { ok: true, json: async () => POST_CASE };
      if (path === "/admin/posts/post_1/remove") return { ok: true, status: 204, json: async () => ({}) };
      throw new Error(`unexpected path ${path}`);
    });
    render(<CaseDetail caseId="case_1" />);

    const removeButton = await screen.findByRole("button", { name: /remove post/i });
    expect(removeButton).toBeDisabled();

    await user.type(screen.getByLabelText(/reason \(required/i), "explicit nudity");
    expect(removeButton).toBeEnabled();

    await user.click(removeButton);

    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith(
        "/admin/posts/post_1/remove",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    const call = apiFetchMock.mock.calls.find((c) => c[0] === "/admin/posts/post_1/remove");
    expect(JSON.parse(call![1].body as string)).toEqual({ reason: "explicit nudity", caseId: "case_1" });
  });

  it("hides action buttons once the case is resolved", async () => {
    apiFetchMock.mockResolvedValue({ ok: true, json: async () => ({ ...POST_CASE, status: "DISMISSED" }) });
    render(<CaseDetail caseId="case_1" />);

    await waitFor(() => expect(screen.getByText(/this case is resolved/i)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /remove post/i })).not.toBeInTheDocument();
  });
});
