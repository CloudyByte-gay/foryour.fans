"use client";

import { Input, Label } from "@/components/ui";
import { cn } from "@/lib/cn";
import { dashboardPresetLabel, presetRange, type DashboardRangePreset, type DashboardRangeQuery } from "@/lib/dashboard";

const PRESETS: Exclude<DashboardRangePreset, "custom">[] = ["7d", "30d", "90d"];

export function DateRangeFilter({
  preset,
  range,
  onChange,
}: {
  preset: DashboardRangePreset;
  range: DashboardRangeQuery;
  onChange: (preset: DashboardRangePreset, range: DashboardRangeQuery) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div role="group" aria-label="Date range" className="inline-flex rounded-md border border-border p-0.5">
        {PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onChange(p, presetRange(p))}
            aria-pressed={preset === p}
            className={cn(
              "rounded px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              preset === p ? "bg-primary text-primary-foreground" : "text-muted hover:text-foreground",
            )}
          >
            {dashboardPresetLabel(p)}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Label htmlFor="dashboard-range-from" className="sr-only">
          Start date
        </Label>
        <Input
          id="dashboard-range-from"
          type="date"
          value={range.from}
          max={range.to}
          className="w-auto"
          onChange={(e) => onChange("custom", { ...range, from: e.target.value })}
        />
        <span className="text-sm text-muted">to</span>
        <Label htmlFor="dashboard-range-to" className="sr-only">
          End date
        </Label>
        <Input
          id="dashboard-range-to"
          type="date"
          value={range.to}
          min={range.from}
          max={new Date().toISOString().slice(0, 10)}
          className="w-auto"
          onChange={(e) => onChange("custom", { ...range, to: e.target.value })}
        />
      </div>
    </div>
  );
}
