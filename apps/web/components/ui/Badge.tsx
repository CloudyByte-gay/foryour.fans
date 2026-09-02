import { type VariantProps, cva } from "class-variance-authority";
import { cn } from "@/lib/cn";

export const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium",
  {
    variants: {
      variant: {
        neutral: "border-border bg-surface-muted text-muted",
        primary: "border-transparent bg-primary/15 text-primary",
        success: "border-transparent bg-success/15 text-success",
        warning: "border-transparent bg-warning/20 text-warning",
        danger: "border-transparent bg-danger/15 text-danger",
        /** Subscriber-only / premium tier marker (requirement #4). */
        locked: "border-transparent bg-locked/20 text-locked",
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
