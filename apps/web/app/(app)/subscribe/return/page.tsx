import type { Metadata } from "next";
import { Suspense } from "react";
import { ReconcilingFallback, SubscribeReturn } from "./SubscribeReturn";

export const metadata: Metadata = {
  title: "Finishing your subscription",
  robots: { index: false, follow: false },
};

// Reached by a redirect back from the hosted checkout — nothing to prerender.
export const dynamic = "force-dynamic";

export default function SubscribeReturnPage() {
  return (
    <div className="mx-auto max-w-md py-10">
      <Suspense fallback={<ReconcilingFallback />}>
        <SubscribeReturn />
      </Suspense>
    </div>
  );
}
