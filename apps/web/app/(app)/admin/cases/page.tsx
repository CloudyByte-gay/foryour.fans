import type { Metadata } from "next";
import { CaseQueue } from "./CaseQueue";

export const metadata: Metadata = { title: "Admin — case queue" };

export default function AdminCasesPage() {
  return <CaseQueue />;
}
