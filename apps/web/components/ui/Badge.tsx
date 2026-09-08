import { type VariantProps, cva } from "class-variance-authority";
import { cn } from "@/lib/cn";

export const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
  {
    variants: {
      variant: {
        neutral: "border-border bg-surface-muted text-muted",
        // WEB PHASE 15 — each `text-{color}-badge` is a darkened/lightened,
        // same-hue shade tuned against THIS tinted background specifically
        // (see globals.css) — the plain `text-{color}` DEFAULT (used
        // elsewhere for buttons/borders/plain text) doesn't clear WCAG AA
        // here for several variants at this text size.
        primary: "border-transparent bg-primary/15 text-primary-badge",
        success: "border-transparent bg-success/15 text-success-badge",
        warning: "border-transparent bg-warning/20 text-warning-badge",
        danger: "border-transparent bg-danger/15 text-danger-badge",
        /** Subscriber-only / premium tier marker (requirement #4). */
        locked: "border-transparent bg-locked/20 text-locked-badge",
      },
    },
    defaultVariants: {
      variant: "neutral",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
