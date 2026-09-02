"use client";

import { AlertTriangle, Check, Loader2, X } from "lucide-react";
import { useState } from "react";
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  FormControl,
  FormDescription,
  FormField,
  FormLabel,
  Input,
} from "@/components/ui";
import { apiFetch } from "@/lib/apiFetch";
import { cn } from "@/lib/cn";
import { csrfHeaders } from "@/lib/csrf";
import { sanitizeSlugInput } from "@/lib/slug";
import { useSlugAvailability } from "@/lib/useSlugAvailability";

export function SlugChangeDialog({ currentSlug }: { currentSlug: string }) {
  const [open, setOpen] = useState(false);
  const [next, setNext] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { status, shapeError } = useSlugAvailability(next, { currentSlug });

  const unchanged = next === currentSlug || next.length === 0;
  const canSubmit = !unchanged && !shapeError && status === "available" && !submitting;

  function reset() {
    setNext("");
    setError(null);
    setSubmitting(false);
  }

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiFetch("/creators/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...csrfHeaders() },
        body: JSON.stringify({ slug: next }),
      });
      if (res.ok) {
        window.location.assign(`/c/${next}`);
        return;
      }
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      setError(body?.error?.message ?? "Couldn't change your slug. Try again.");
    } catch {
      setError("We couldn't reach foryour.fans. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="secondary" size="sm">
          Change slug
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change your page slug</DialogTitle>
          <DialogDescription>
            Your page is currently <span className="font-mono">/c/{currentSlug}</span>.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
          <p>
            Every existing link to <span className="font-mono">/c/{currentSlug}</span> will break —
            there is no redirect from the old address. You can only change your slug{" "}
            <strong className="font-semibold">once every 7 days</strong>.
          </p>
        </div>

        <form
          id="slug-change-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) void submit();
          }}
        >
          <FormField error={shapeError ?? undefined}>
            <FormLabel>New slug</FormLabel>
            <div className="relative">
              <FormControl>
                <Input
                  value={next}
                  onChange={(e) => setNext(sanitizeSlugInput(e.target.value))}
                  placeholder="new-slug"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  aria-invalid={Boolean(shapeError)}
                />
              </FormControl>
              <span className="absolute right-2.5 top-1/2 -translate-y-1/2">
                {status === "checking" && <Loader2 className="h-4 w-4 animate-spin text-muted" aria-hidden />}
                {!unchanged && status === "available" && <Check className="h-4 w-4 text-success" aria-hidden />}
                {(status === "taken" || status === "error") && <X className="h-4 w-4 text-danger" aria-hidden />}
              </span>
            </div>
            <FormDescription
              className={cn(
                status === "taken" && "text-danger",
                !unchanged && status === "available" && "text-success",
              )}
            >
              {status === "taken"
                ? `/c/${next} is taken.`
                : !unchanged && status === "available"
                  ? `/c/${next} is available.`
                  : "3–32 characters. Lowercase letters, numbers and hyphens."}
            </FormDescription>
          </FormField>
        </form>

        {error && (
          <p role="alert" className="rounded-md border border-danger/40 bg-danger/10 p-3 text-sm">
            {error}
          </p>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button
            type="submit"
            form="slug-change-form"
            variant="destructive"
            disabled={!canSubmit}
            loading={submitting}
          >
            Change slug &amp; break old links
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
