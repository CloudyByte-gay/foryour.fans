"use client";

import { Check } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { apiFetch } from "@/lib/apiFetch";
import { confirmAge } from "@/lib/ageVerification";
import { csrfHeaders } from "@/lib/csrf";
import { ProfileStep, RatingStep, ReviewStep, type WizardData } from "./steps";

const STEPS = [
  { key: "profile", label: "Profile" },
  { key: "rating", label: "Content rating" },
  { key: "review", label: "Review" },
] as const;

const EMPTY: WizardData = {
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

export function OnboardingWizard({ handle, did }: { handle: string | null; did: string | null }) {
  const [step, setStep] = useState(0);
  const [data, setData] = useState<WizardData>(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Your page address is your AT handle (or the DID if the handle isn't known
  // to this render) — never something entered here.
  const pageAddress = handle ?? did ?? "";

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
          displayName: data.displayName.trim() || undefined,
          bio: data.bio.trim() || undefined,
          website: data.website.trim() || undefined,
        }),
      });

      if (res.ok) {
        // The wizard's own 18+ confirmation doubles as the WEB PHASE 14 age
        // gate's self-attestation (lib/ageVerification.ts) — no reason to
        // ask again immediately after asking here.
        if (data.ageConfirmed) confirmAge();

        // A creator who said they'll post adult content needs real identity
        // verification before they actually can (apps/api/src/routes/posts.ts
        // 403s an unverified creator's containsAdultContent post/tier) — send
        // them straight to that flow instead of their brand-new empty page.
        const destination = data.willPostAdult ? "/creator/verification" : `/c/${pageAddress}`;
        // Full navigation so the shell picks up creator status.
        window.location.assign(destination);
        return;
      }

      const body = (await res.json().catch(() => null)) as ApiError | null;
      const message = body?.error?.message ?? "Something went wrong creating your account.";
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

      {step === 0 && <ProfileStep value={data} onChange={patch} onNext={next} />}
      {step === 1 && <RatingStep value={data} onChange={patch} onNext={next} onBack={back} />}
      {step === 2 && (
        <ReviewStep
          value={data}
          pageAddress={pageAddress}
          onBack={back}
          onSubmit={submit}
          submitting={submitting}
          error={error}
        />
      )}
    </div>
  );
}
