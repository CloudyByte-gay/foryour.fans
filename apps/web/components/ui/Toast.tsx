"use client";

import * as ToastPrimitive from "@radix-ui/react-toast";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";

export type ToastVariant = "default" | "success" | "warning" | "error";

export interface ToastOptions {
  title: string;
  description?: string;
  variant?: ToastVariant;
  /** ms before auto-dismiss. `Infinity` to require manual close. */
  duration?: number;
}

interface ToastRecord extends ToastOptions {
  id: string;
}

type Listener = (toasts: ToastRecord[]) => void;

let toasts: ToastRecord[] = [];
const listeners = new Set<Listener>();

function emit() {
  for (const listener of listeners) listener(toasts);
}

/**
 * Imperative toast. Safe to call from event handlers, fetch wrappers, etc.
 * Rendering happens in <Toaster />, which must be mounted once (in Providers).
 */
export function toast(options: ToastOptions): string {
  const id = Math.random().toString(36).slice(2);
  toasts = [...toasts, { id, ...options }];
  emit();
  return id;
}

export function dismissToast(id: string) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

const variantClass: Record<ToastVariant, string> = {
  default: "border-border",
  success: "border-success/40",
  warning: "border-warning/40",
  error: "border-danger/40",
};

export function Toaster() {
  const [items, setItems] = useState<ToastRecord[]>(toasts);

  useEffect(() => {
    const listener: Listener = (next) => setItems([...next]);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  return (
    <ToastPrimitive.Provider swipeDirection="right">
      {items.map(({ id, title, description, variant = "default", duration }) => (
        <ToastPrimitive.Root
          key={id}
          duration={duration ?? 5000}
          onOpenChange={(open) => {
            if (!open) dismissToast(id);
          }}
          className={cn(
            "grid grid-cols-[1fr_auto] items-start gap-3 rounded-md border bg-surface p-4 shadow-pop",
            "data-[state=open]:animate-slide-up-fade data-[swipe=end]:animate-fade-in",
            variantClass[variant],
          )}
        >
          <div className="space-y-1">
            <ToastPrimitive.Title className="text-sm font-semibold">{title}</ToastPrimitive.Title>
            {description && (
              <ToastPrimitive.Description className="text-sm text-muted">
                {description}
              </ToastPrimitive.Description>
            )}
          </div>
          <ToastPrimitive.Close
            aria-label="Dismiss"
            className="rounded-sm text-muted transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-4 w-4" aria-hidden />
          </ToastPrimitive.Close>
        </ToastPrimitive.Root>
      ))}
      <ToastPrimitive.Viewport className="fixed bottom-0 right-0 z-[100] flex w-[calc(100vw-2rem)] max-w-sm flex-col gap-2 p-4 outline-none" />
    </ToastPrimitive.Provider>
  );
}
