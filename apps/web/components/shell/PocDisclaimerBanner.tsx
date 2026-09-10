import { Info } from "lucide-react";

/**
 * Mounted once in `Providers` (above every route's own content), same as
 * `OfflineBanner`, so it's guaranteed to appear on every page regardless of
 * route group. Static and server-rendered — no client state needed.
 */
export function PocDisclaimerBanner() {
  return (
    <div role="note" className="border-b border-warning/30 bg-warning/10 px-4 py-2">
      <p className="mx-auto flex max-w-4xl items-center gap-2 text-sm text-foreground">
        <Info className="h-4 w-4 shrink-0 text-warning" aria-hidden />
        <span>
          This is a proof-of-concept application, developed with AI-assisted tooling under human
          guidance. It is not a production service.
        </span>
      </p>
    </div>
  );
}
