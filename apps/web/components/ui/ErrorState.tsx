"use client";

import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "./Button";

interface ErrorStateProps {
  title?: string;
  message?: string;
  /** When provided, renders a "Try again" button wired to it. */
  onRetry?: () => void;
  retrying?: boolean;
  className?: string;
}

/** The `error` state for a data view — always offers a retry (requirement #3). */
export function ErrorState({
  title = "Something went wrong",
  message = "We couldn't load this. Please try again.",
  onRetry,
  retrying = false,
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-lg border border-danger/30 bg-danger/5 px-6 py-12 text-center",
        className,
      )}
    >
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-danger/15 text-danger">
        <AlertTriangle className="h-5 w-5" aria-hidden />
      </span>
      <div className="space-y-1">
        <p className="font-display text-base font-semibold">{title}</p>
        <p className="mx-auto max-w-sm text-sm text-muted">{message}</p>
      </div>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry} loading={retrying}>
          Try again
        </Button>
      )}
    </div>
  );
}
