import type { Metadata } from "next";
import { CaseDetail } from "./CaseDetail";

export const metadata: Metadata = { title: "Admin — case detail" };

export default async function AdminCaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CaseDetail caseId={id} />;
}
