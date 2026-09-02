import type { Metadata } from "next";
import { LegalPage } from "@/components/marketing/LegalPage";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "Placeholder Terms of Service for foryour.fans, pending legal review.",
  alternates: { canonical: "/terms" },
  robots: { index: false },
};

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      lastUpdated="September 2026"
      intro="These terms will govern your use of foryour.fans once finalized. The structure below is a placeholder for the sections a completed document is expected to cover."
      sections={[
        {
          heading: "Your account and identity",
          body: "foryour.fans uses your AT Protocol identity for sign-in and does not create a separate username/password. You are responsible for the security of the identity you authenticate with.",
        },
        {
          heading: "Creator content and payments",
          body: "Creators set their own subscription tiers and prices. Subscribers are charged the price in effect when they subscribed. Payment processing terms will be described here once a processor is selected.",
        },
        {
          heading: "Acceptable use",
          body: "Rules for prohibited content and conduct, including how adult content must be labeled, will be detailed here alongside the moderation and appeals process.",
        },
        {
          heading: "Portability and termination",
          body: "Public records are written to your own AT Protocol repository and remain yours. This section will describe what happens to your foryour.fans account and any subscriptions on termination.",
        },
      ]}
    />
  );
}
