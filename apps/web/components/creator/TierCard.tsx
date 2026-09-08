import type { ReactNode } from "react";
import { Badge, Card, CardContent } from "@/components/ui";
import { formatPrice } from "@/lib/tier";

export interface PublicTier {
  id: string;
  name: string;
  description: string | null;
  priceCents: number;
  currency: string;
  sortOrder: number;
  createdAt: string;
  /** WEB PHASE 14 — optional like foryourAtUri et al. (lib/post.ts): the API always sends it, older fixtures may omit it. */
  containsAdultContent?: boolean;
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
          <div className="flex flex-wrap items-center gap-1.5">
            <h3 className="font-display text-base font-semibold">{tier.name}</h3>
            {tier.containsAdultContent && <Badge variant="danger">18+</Badge>}
          </div>
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
