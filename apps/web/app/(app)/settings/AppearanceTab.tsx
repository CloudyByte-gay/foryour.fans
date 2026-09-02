"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui";
import { useTheme } from "@/components/providers/ThemeProvider";
import { cn } from "@/lib/cn";
import type { ThemePreference } from "@/lib/theme";

const OPTIONS: { value: ThemePreference; label: string; icon: LucideIcon }[] = [
  { value: "system", label: "System", icon: Monitor },
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
];

export function AppearanceTab() {
  const { preference, resolved, setPreference } = useTheme();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Theme</CardTitle>
        <CardDescription>
          Choose how foryour.fans looks. &ldquo;System&rdquo; follows your device setting
          (currently {resolved}). Your choice is saved to this browser.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <fieldset>
          <legend className="sr-only">Theme preference</legend>
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Theme preference">
            {OPTIONS.map(({ value, label, icon: Icon }) => {
              const active = preference === value;
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setPreference(value)}
                  className={cn(
                    "flex flex-col items-center gap-2 rounded-lg border p-4 text-sm font-medium transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    active
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border text-muted hover:bg-surface-muted hover:text-foreground",
                  )}
                >
                  <Icon className="h-5 w-5" aria-hidden />
                  {label}
                </button>
              );
            })}
          </div>
        </fieldset>
      </CardContent>
    </Card>
  );
}
