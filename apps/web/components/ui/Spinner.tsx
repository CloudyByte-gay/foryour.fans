import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

interface SpinnerProps {
  className?: string;
  /** Accessible label; omit inside a button that already has visible text. */
  label?: string;
}

export function Spinner({ className, label }: SpinnerProps) {
  return (
    <Loader2
      role={label ? "status" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn("h-4 w-4 animate-spin motion-reduce:animate-[spin_1.5s_linear_infinite]", className)}
    />
  );
}
