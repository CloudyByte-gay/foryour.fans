import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui";
import { formatPrice } from "@/lib/tier";

export interface PublicTier {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  currency: string;
  sortOrder: number;
  createdAt: string;
}

/**
 * A creator's public membership tier, as shown on `/c/:handle`. `action` is
 * the subscribe slot — a disabled placeholder until WEB PHASE 6 wires the
 * subscribe flow.
 */
export function TierCard({ tier, action }: { tier: PublicTier; action?: ReactNode }) {
  return (
    <Card className="flex h-full flex-col">
      <CardContent className="flex flex-1 flex-col gap-3 py-5">
        <div>
          <h3 className="font-display text-base font-semibold">{tier.name}</h3>
          <p className="mt-0.5 text-sm text-muted">
            <span className="font-medium text-foreground">{formatPrice(tier.priceCents, tier.currency)}</span> / month
          </p>
        </div>
        {tier.description && (
          <p className="whitespace-pre-line text-sm leading-relaxed text-muted">{tier.description}</p>
        )}
        {action && <div className="mt-auto pt-1">{action}</div>}
      </CardContent>
    </Card>
  );
}
