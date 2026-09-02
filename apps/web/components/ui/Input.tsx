import { forwardRef } from "react";
import { cn } from "@/lib/cn";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  invalid?: boolean;
};

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, invalid, "aria-invalid": ariaInvalid, ...props }, ref) => (
    <input
      ref={ref}
      aria-invalid={ariaInvalid ?? invalid}
      className={cn(
        "flex h-10 w-full rounded-md border bg-surface px-3 py-2 text-sm text-foreground shadow-sm transition-colors",
        "placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "aria-[invalid=true]:border-danger aria-[invalid=true]:ring-danger/40",
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = "Input";
