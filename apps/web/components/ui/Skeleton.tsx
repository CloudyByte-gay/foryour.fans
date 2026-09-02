import { cn } from "@/lib/cn";

/**
 * Placeholder block for the `loading` state every data view must ship
 * (requirement #3). Mark the region `aria-busy` and hide skeletons from AT.
 */
export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden
      className={cn(
        "relative overflow-hidden rounded-md bg-surface-muted",
        "before:absolute before:inset-0 before:-translate-x-full before:animate-shimmer",
        "before:bg-gradient-to-r before:from-transparent before:via-foreground/5 before:to-transparent",
        "motion-reduce:before:animate-none",
        className,
      )}
      {...props}
    />
  );
}
