import { ChevronDown } from "lucide-react";
import { forwardRef } from "react";
import { cn } from "@/lib/cn";

export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement> & {
  invalid?: boolean;
};

/**
 * A styled native `<select>`. prompts/web.md's Radix list doesn't include
 * Select; the native element is smaller, fully accessible and works without
 * JS, which is enough for the forms in later phases.
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, invalid, "aria-invalid": ariaInvalid, children, ...props }, ref) => (
    <div className="relative">
      <select
        ref={ref}
        aria-invalid={ariaInvalid ?? invalid}
        className={cn(
          "flex h-10 w-full appearance-none rounded-md border bg-surface px-3 pr-9 text-sm text-foreground shadow-sm transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "aria-[invalid=true]:border-danger aria-[invalid=true]:ring-danger/40",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
      />
    </div>
  ),
);
Select.displayName = "Select";
