"use client";

import { Check } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { apiFetch } from "@/lib/apiFetch";
import { csrfHeaders } from "@/lib/csrf";
import { SlugStep } from "./SlugStep";
import { ProfileStep, RatingStep, ReviewStep, type WizardData } from "./steps";

const STEPS = [
  { key: "slug", label: "Slug" },
  { key: "profile", label: "Profile" },
  { key: "rating", label: "Content rating" },
  { key: "review", label: "Review" },
] as const;

const EMPTY: WizardData = {
  slug: "",
  displayName: "",
  bio: "",
  website: "",
  ageConfirmed: false,
  willPostAdult: false,
};

function Stepper({ current }: { current: number }) {
  return (
    <ol className="flex items-center gap-2" aria-label="Progress">
      {STEPS.map((step, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={step.key} className="flex items-center gap-2">
            <span
              className={cn(
                "flex h-6 w-6 items-center justify-center rounded-full border text-xs font-medium",
                done && "border-primary bg-primary text-primary-foreground",
                active && "border-primary text-primary",
                !done && !active && "border-border text-muted",
              )}
              aria-current={active ? "step" : undefined}
            >
              {done ? <Check className="h-3.5 w-3.5" aria-hidden /> : i + 1}
            </span>
            <span className={cn("hidden text-sm sm:inline", active ? "text-foreground" : "text-muted")}>
              {step.label}
            </span>
            {i < STEPS.length - 1 && <span className="h-px w-4 bg-border sm:w-8" aria-hidden />}
          </li>
        );
      })}
    </ol>
  );
}

interface ApiError {
  error?: { message?: string; statusCode?: number };
}

export function OnboardingWizard() {
  const [step, setStep] = useState(0);
  const [data, setData] = useState<WizardData>(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const patch = (p: Partial<WizardData>) => setData((d) => ({ ...d, ...p }));
  const back = () => {
    setError(null);
    setStep((s) => Math.max(0, s - 1));
  };
  const next = () => {
    setError(null);
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
  };

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiFetch("/creators", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...csrfHeaders() },
        body: JSON.stringify({
          slug: data.slug,
          displayName: data.displayName.trim() || undefined,
          bio: data.bio.trim() || undefined,
          website: data.website.trim() || undefined,
        }),
      });

      if (res.ok) {
        // Full navigation so the shell picks up creator status.
        window.location.assign(`/c/${data.slug}`);
        return;
      }

      const body = (await res.json().catch(() => null)) as ApiError | null;
      const message = body?.error?.message ?? "Something went wrong creating your account.";
      // A slug problem (400 shape / 409 taken / 429 cooldown) sends the user back to step 1.
      if ([400, 409, 429].includes(res.status)) {
        setStep(0);
      }
      setError(message);
    } catch {
      setError("We couldn't reach foryour.fans. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-8">
      <Stepper current={step} />

      {step === 0 && (
        <SlugStep value={data.slug} onChange={(slug) => patch({ slug })} onNext={next} />
      )}
      {step === 1 && (
        <ProfileStep value={data} onChange={patch} onNext={next} onBack={back} />
      )}
      {step === 2 && <RatingStep value={data} onChange={patch} onNext={next} onBack={back} />}
      {step === 3 && (
        <ReviewStep value={data} onBack={back} onSubmit={submit} submitting={submitting} error={error} />
      )}

      {error && step === 0 && (
        <p role="alert" className="rounded-md border border-danger/40 bg-danger/10 p-3 text-sm">
          {error}
        </p>
      )}
    </div>
  );
}
