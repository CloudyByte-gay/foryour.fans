import Link from "next/link";
import { Check, Circle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import { cn } from "@/lib/cn";

interface GuidanceItem {
  label: string;
  href: string;
  cta: string;
  done: boolean;
}

/** The empty/new-creator state (WEB PHASE 13): guidance instead of an all-zero dashboard. */
export function NewCreatorGuidance({ hasPost, hasTier, payoutVerified }: { hasPost: boolean; hasTier: boolean; payoutVerified: boolean }) {
  const items: GuidanceItem[] = [
    { label: "Publish your first post", href: "/creator/posts/new", cta: "Write a post", done: hasPost },
    { label: "Create a subscription tier", href: "/creator/tiers", cta: "Set up tiers", done: hasTier },
    { label: "Finish payout onboarding", href: "/creator/payouts", cta: "Set up payouts", done: payoutVerified },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Get your dashboard started</CardTitle>
        <p className="text-sm text-muted">Your numbers will show up here once you've done a few things.</p>
      </CardHeader>
      <CardContent>
        <ul className="space-y-3">
          {items.map((item) => (
            <li key={item.href} className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-sm">
                {item.done ? (
                  <Check className="h-4 w-4 shrink-0 text-success" aria-hidden />
                ) : (
                  <Circle className="h-4 w-4 shrink-0 text-muted" aria-hidden />
                )}
                <span className={cn(item.done && "text-muted line-through")}>{item.label}</span>
              </span>
              {!item.done && (
                <Link href={item.href} className="shrink-0 text-sm font-medium text-primary hover:underline">
                  {item.cta}
                </Link>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
