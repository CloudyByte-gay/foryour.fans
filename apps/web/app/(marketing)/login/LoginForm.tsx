"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangle } from "lucide-react";
import { forwardRef, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button, FormDescription, FormField, FormLabel, Input, useFormField } from "@/components/ui";
import { storePostLoginNext } from "@/lib/nav";

// AT handles are domain names. This only checks the *shape* — the real
// resolution happens server-side; a well-formed handle that doesn't resolve
// comes back as a start error below.
const HANDLE_RE = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

function normalizeHandle(value: string): string {
  return value.trim().replace(/^@/, "").toLowerCase();
}

const schema = z.object({
  handle: z
    .string()
    .trim()
    .min(1, "Enter your Bluesky handle")
    .refine((value) => HANDLE_RE.test(normalizeHandle(value)), {
      message: "That doesn't look like a handle — try something like alice.bsky.social",
    }),
});

type FormValues = z.infer<typeof schema>;

interface ApiError {
  error?: { message?: string };
}

const HandleInput = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  (props, ref) => {
    // Pulls `id` / `aria-describedby` / `aria-invalid` from the FormField
    // context; the caller spreads `register("handle")` (name/onChange/ref).
    const field = useFormField();
    return <Input ref={ref} {...field} {...props} />;
  },
);
HandleInput.displayName = "HandleInput";

export function LoginForm({ next }: { next?: string }) {
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting, isSubmitSuccessful },
  } = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: { handle: "" } });

  async function onSubmit(values: FormValues) {
    setFormError(null);
    const handle = normalizeHandle(values.handle);

    // Stash where to return *before* leaving the origin for the PDS.
    storePostLoginNext(next);

    let res: Response;
    try {
      res = await fetch("/api/auth/atproto/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handle }),
      });
    } catch {
      setFormError("We couldn't reach foryour.fans. Check your connection and try again.");
      return;
    }

    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as ApiError | null;
      const apiMessage = body?.error?.message ?? "";
      if (/handle is required/i.test(apiMessage)) {
        setFormError("Enter your Bluesky handle.");
      } else {
        setFormError(
          `We couldn't start sign-in for @${handle}. That usually means the handle doesn't resolve or its server (PDS) is unreachable — double-check the spelling and try again.`,
        );
      }
      return;
    }

    const { redirectUrl } = (await res.json()) as { redirectUrl: string };
    // Full-page navigation to the authorization server.
    window.location.href = redirectUrl;
  }

  // Keep the button in its loading state through the redirect that follows a
  // successful start call.
  const busy = isSubmitting || (isSubmitSuccessful && !formError);

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="mt-8 space-y-4">
      <FormField error={errors.handle?.message}>
        <FormLabel>Bluesky handle</FormLabel>
        <HandleInput
          {...register("handle")}
          placeholder="alice.bsky.social"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
          disabled={busy}
        />
        <FormDescription>
          Your Bluesky handle (or any AT Protocol identity), like alice.bsky.social.
        </FormDescription>
      </FormField>

      {formError && (
        <p
          role="alert"
          className="flex gap-2 rounded-md border border-danger/40 bg-danger/10 p-3 text-sm text-foreground"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden />
          <span>{formError}</span>
        </p>
      )}

      <Button type="submit" size="lg" className="w-full" loading={busy}>
        {busy ? "Redirecting" : "Continue with Bluesky"}
      </Button>

      <p className="text-xs text-muted">
        You&rsquo;ll be sent to your identity provider to authorize foryour.fans, then brought back
        here. We never see your password.
      </p>
    </form>
  );
}
