import type { Metadata } from "next";
import { LegalPage } from "@/components/marketing/LegalPage";

export const metadata: Metadata = {
  title: "Compliance",
  description: "Placeholder compliance information for foryour.fans, pending legal review.",
  alternates: { canonical: "/legal/compliance" },
  robots: { index: false },
};

export default function CompliancePage() {
  return (
    <LegalPage
      title="Compliance"
      lastUpdated="September 2026"
      intro="foryour.fans hosts adult content, which carries specific legal and operational obligations. This page is a placeholder for that information once it has been reviewed."
      sections={[
        {
          heading: "Age verification",
          body: "Viewing adult content, subscribing to adult creators, and payout onboarding are gated on age confirmation. Early builds use a self-attestation placeholder; a real verification flow lands in a later phase.",
        },
        {
          heading: "Creator identity verification",
          body: "Before a creator can be paid out or post content marked adult, their identity must be verified. The verification vendor and retention rules will be documented here.",
        },
        {
          heading: "Record-keeping and reporting",
          body: "Obligations such as performer record-keeping and any mandated reporting will be described here after legal review — foryour.fans does not assert specific requirements on this page yet.",
        },
        {
          heading: "Takedowns and moderation",
          body: "How to report content, how moderation cases are handled, and how to appeal a decision will be covered here and in the Terms of Service.",
        },
      ]}
    />
  );
}
