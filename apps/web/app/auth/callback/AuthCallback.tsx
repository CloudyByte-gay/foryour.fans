"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button, Spinner } from "@/components/ui";
import { takePostLoginNext } from "@/lib/nav";

export function FinishingSignIn() {
  return (
    <div className="flex flex-col items-center gap-3 text-center" role="status">
      <Spinner className="h-6 w-6 text-primary" />
      <p className="text-sm text-muted">Finishing sign-in…</p>
    </div>
  );
}

type Phase = "working" | "error";

/** Copy per authorization-server error code. `access_denied` = user declined. */
function describeError(code: string | null): { title: string; message: string } {
  if (code === "access_denied") {
    return {
      title: "Sign-in cancelled",
      message: "You didn't finish authorizing foryour.fans. You can try again whenever you're ready.",
    };
  }
  return {
    title: "Sign-in didn't finish",
    message:
      "Something went wrong completing your sign-in. This is usually temporary — please try again.",
  };
}

export function AuthCallback() {
  const params = useSearchParams();
  const errorCode = params.get("error");
  const [phase] = useState<Phase>(errorCode ? "error" : "working");
  const started = useRef(false);

  useEffect(() => {
    if (phase !== "working" || started.current) return;
    started.current = true;

    void (async () => {
      const next = takePostLoginNext();
      if (next) {
        // Full navigation so the server shell re-resolves the new session.
        window.location.replace(next);
        return;
      }

      // No explicit destination: brand-new users (no creator account) land on
      // the dashboard with a setup nudge; returning users just go there.
      let hasCreator = false;
      try {
        const res = await fetch("/api/creators/me", { credentials: "same-origin" });
        hasCreator = res.ok;
      } catch {
        hasCreator = false;
      }
      window.location.replace(hasCreator ? "/dashboard" : "/dashboard?welcome=1");
    })();
  }, [phase]);

  if (phase === "error") {
    const { title, message } = describeError(errorCode);
    const retryNext = takePostLoginNext();
    const loginHref = retryNext ? `/login?next=${encodeURIComponent(retryNext)}` : "/login";
    return (
      <div className="w-full space-y-4 text-center">
        <h1 className="font-display text-xl font-semibold">{title}</h1>
        <p className="text-sm text-muted">{message}</p>
        <div className="flex justify-center gap-3">
          <Button asChild>
            <Link href={loginHref}>Back to sign in</Link>
          </Button>
          <Button asChild variant="ghost">
            <Link href="/">Home</Link>
          </Button>
        </div>
      </div>
    );
  }

  return <FinishingSignIn />;
}
