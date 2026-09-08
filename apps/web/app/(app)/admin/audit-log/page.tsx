import type { Metadata } from "next";
import { AuditLogViewer } from "./AuditLogViewer";

export const metadata: Metadata = { title: "Admin — audit log" };

export default function AdminAuditLogPage() {
  return <AuditLogViewer />;
}
