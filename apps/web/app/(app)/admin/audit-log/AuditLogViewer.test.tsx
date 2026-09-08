import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuditLogViewer } from "./AuditLogViewer";

const apiFetchMock = vi.fn();
vi.mock("@/lib/apiFetch", () => ({ apiFetch: (...a: unknown[]) => apiFetchMock(...a) }));

const user = userEvent.setup();

const LOG_ENTRY = {
  id: "log_1",
  actorUserId: "admin_1",
  actorRole: "ADMIN",
  action: "CONTENT_REMOVED",
  targetType: "POST",
  targetId: "post_1",
  moderationCaseId: "case_1",
  metadata: { reason: "explicit nudity" },
  createdAt: "2026-01-01T00:00:00.000Z",
  actor: { id: "admin_1", did: "did:plc:admin", handle: "admin" },
};

beforeEach(() => {
  apiFetchMock.mockReset();
});

describe("AuditLogViewer", () => {
  it("loads and shows entries with actor, action, and metadata", async () => {
    apiFetchMock.mockResolvedValue({ ok: true, json: async () => [LOG_ENTRY] });
    render(<AuditLogViewer />);

    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledWith("/admin/audit-log?limit=100"));
    expect(screen.getByText(/content removed/i)).toBeInTheDocument();
    expect(screen.getByText(/by @admin/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "post_1" })).toHaveAttribute("href", "/admin/cases/case_1");
    expect(screen.getByText(/"reason": "explicit nudity"/)).toBeInTheDocument();
  });

  it("shows an empty state when there are no entries", async () => {
    apiFetchMock.mockResolvedValue({ ok: true, json: async () => [] });
    render(<AuditLogViewer />);
    await waitFor(() => expect(screen.getByText(/no matching audit log entries/i)).toBeInTheDocument());
  });

  it("shows an error state with retry", async () => {
    apiFetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    render(<AuditLogViewer />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());

    apiFetchMock.mockResolvedValue({ ok: true, json: async () => [LOG_ENTRY] });
    await user.click(screen.getByRole("button", { name: /try again/i }));
    await waitFor(() => expect(screen.getByText(/content removed/i)).toBeInTheDocument());
  });

  it("re-fetches when the target-type filter changes", async () => {
    apiFetchMock.mockResolvedValue({ ok: true, json: async () => [] });
    render(<AuditLogViewer />);
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledWith("/admin/audit-log?limit=100"));

    await user.selectOptions(screen.getByLabelText(/filter by target type/i), "CREATOR");
    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith("/admin/audit-log?targetType=CREATOR&limit=100"),
    );
  });
});
