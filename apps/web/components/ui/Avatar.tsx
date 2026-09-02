"use client";

import * as AvatarPrimitive from "@radix-ui/react-avatar";
import { forwardRef } from "react";
import { cn } from "@/lib/cn";

/** First letters of the first two words, e.g. "Ada Lovelace" -> "AL". */
export function initialsFrom(name: string | null | undefined): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0].charAt(0);
  const last = parts.length > 1 ? parts[parts.length - 1].charAt(0) : "";
  return (first + last).toUpperCase() || "?";
}

const sizeClass = {
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-16 w-16 text-lg",
  xl: "h-24 w-24 text-2xl",
} as const;

export interface AvatarProps {
  src?: string | null;
  /** Used both as alt text and to derive fallback initials. */
  name?: string | null;
  size?: keyof typeof sizeClass;
  className?: string;
}

export const Avatar = forwardRef<React.ElementRef<typeof AvatarPrimitive.Root>, AvatarProps>(
  ({ src, name, size = "md", className }, ref) => (
    <AvatarPrimitive.Root
      ref={ref}
      className={cn(
        "relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-full bg-surface-muted",
        sizeClass[size],
        className,
      )}
    >
      {src && (
        <AvatarPrimitive.Image
          src={src}
          alt={name ?? ""}
          className="aspect-square h-full w-full object-cover"
        />
      )}
      <AvatarPrimitive.Fallback
        delayMs={src ? 300 : 0}
        className="flex h-full w-full items-center justify-center font-medium text-muted"
      >
        {initialsFrom(name)}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  ),
);
Avatar.displayName = "Avatar";
