import Link from "next/link";
import { cn } from "@/lib/cn";

/** The foryour.fans wordmark, used as the home link in every shell. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <Link
      href="/"
      className={cn(
        "font-display text-lg font-bold tracking-tight text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm",
        className,
      )}
    >
      foryour<span className="text-primary">.fans</span>
    </Link>
  );
}
