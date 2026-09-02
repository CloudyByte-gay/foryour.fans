"use client";

import { AlertTriangle, Check, Loader2, X } from "lucide-react";
import { Button, FormControl, FormDescription, FormField, FormLabel, Input } from "@/components/ui";
import { cn } from "@/lib/cn";
import { sanitizeSlugInput } from "@/lib/slug";
import { useSlugAvailability } from "@/lib/useSlugAvailability";

export function SlugStep({
  value,
  onChange,
  onNext,
}: {
  value: string;
  onChange: (slug: string) => void;
  onNext: () => void;
}) {
  const { status, shapeError } = useSlugAvailability(value);
  const canProceed = !shapeError && status === "available";

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (canProceed) onNext();
      }}
      className="space-y-6"
    >
      <div>
        <h2 className="font-display text-xl font-semibold">Choose your page address</h2>
        <p className="mt-1 text-sm text-muted">
          Your public page will live at{" "}
          <span className="font-mono text-foreground">/c/{value || "your-slug"}</span>. Pick
          carefully — changing it later breaks every existing link and is limited to once a week.
        </p>
      </div>

      <FormField error={shapeError ?? undefined}>
        <FormLabel>Page slug</FormLabel>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted">/c/</span>
          <div className="relative flex-1">
            <FormControl>
              <Input
                value={value}
                onChange={(e) => onChange(sanitizeSlugInput(e.target.value))}
                placeholder="your-name"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                aria-invalid={Boolean(shapeError)}
              />
            </FormControl>
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2">
              {status === "checking" && <Loader2 className="h-4 w-4 animate-spin text-muted" aria-hidden />}
              {status === "available" && <Check className="h-4 w-4 text-success" aria-hidden />}
              {(status === "taken" || status === "error") && <X className="h-4 w-4 text-danger" aria-hidden />}
            </span>
          </div>
        </div>
        <FormDescription>3–32 characters. Lowercase letters, numbers and hyphens.</FormDescription>
      </FormField>

      <p
        id="slug-availability"
        aria-live="polite"
        className={cn(
          "min-h-[1.25rem] text-sm",
          status === "available" && "text-success",
          (status === "taken" || status === "error") && "text-danger",
          (status === "idle" || status === "checking") && "text-muted",
        )}
      >
        {status === "checking" && "Checking availability…"}
        {status === "available" && `/c/${value} is available.`}
        {status === "taken" && `/c/${value} is already taken — try another.`}
        {status === "error" && (
          <span className="inline-flex items-center gap-1">
            <AlertTriangle className="h-4 w-4" aria-hidden /> Couldn&rsquo;t check availability. Try again.
          </span>
        )}
      </p>

      <div className="flex justify-end">
        <Button type="submit" disabled={!canProceed}>
          Continue
        </Button>
      </div>
    </form>
  );
}
