import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { AdminNav } from "./AdminNav";
import { getSession } from "@/lib/session";

/**
 * `/admin` — the role-gated moderation console (WEB PHASE 14). The `(app)`
 * layout already redirects an anonymous visitor to `/login`; this adds the
 * `role: "ADMIN"` gate on top of that. A non-admin gets a plain 404, not a
 * 403 — the same "don't confirm this exists" posture used elsewhere in this
 * app (e.g. a post that isn't yours). The API's own `requireAdmin` 403s
 * regardless of what this page does, so this is UX only, never the real
 * authorization boundary.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (session.user?.role !== "ADMIN") {
    notFound();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Admin</h1>
        <p className="text-sm text-muted">Moderation queue, actions, and the audit trail.</p>
      </div>
      <AdminNav />
      {children}
    </div>
  );
}
