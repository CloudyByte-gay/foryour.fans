import type { Metadata } from "next";
import { LegalPage } from "@/components/marketing/LegalPage";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "Placeholder Privacy Policy for foryour.fans, pending legal review.",
  alternates: { canonical: "/privacy" },
  robots: { index: false },
};

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      lastUpdated="September 2026"
      intro="This will describe what data foryour.fans collects, why, and how it is handled. The sections below are placeholders for a completed policy."
      sections={[
        {
          heading: "Data from your AT Protocol identity",
          body: "Your handle, display name, avatar and banner are cached from your public AT Protocol profile. Your DID is stored to identify your account. These public profile fields are owned by your PDS, not by foryour.fans.",
        },
        {
          heading: "Data foryour.fans holds privately",
          body: "Subscription and billing records, entitlements, and (for creators) verification and payout status are stored in foryour.fans' own database and are never written to the public network.",
        },
        {
          heading: "What is public by design",
          body: "Anything you publish as a public post is an AT Protocol record on the open network and can be read and copied by other apps. Subscriber-only content is not public.",
        },
        {
          heading: "Your choices",
          body: "How to refresh cached profile data, deactivate your account, and the limits of deletion for records in your own repository will be described here.",
        },
      ]}
    />
  );
}
