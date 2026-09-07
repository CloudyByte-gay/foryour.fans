"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { DashboardTimeSeriesPoint } from "@/lib/dashboard";

const GRID_STROKE = "hsl(var(--border))";
const AXIS_STROKE = "hsl(var(--muted))";

function formatDayTick(value: string): string {
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}

/**
 * A single-series "over time" line (rendered as a subtly filled area so a
 * flat-zero series still reads as a line, not empty space). One series per
 * chart, so — per the data-viz method — no legend box is needed; the card
 * title above it names the series. Uses the app's own `--primary` brand hue
 * (`currentColor`, inherited from the wrapping element) rather than a
 * separate charting palette, since there's never more than one series on
 * screen at once here.
 */
export function TimeSeriesChart({
  data,
  dataKey,
  formatValue,
  ariaLabel,
}: {
  data: DashboardTimeSeriesPoint[];
  dataKey: "activeSubscriptions" | "mrrCents";
  formatValue: (value: number) => string;
  ariaLabel: string;
}) {
  return (
    <div className="h-56 w-full text-primary" role="img" aria-label={ariaLabel}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={`dashboard-fill-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity={0.18} />
              <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={GRID_STROKE} strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={formatDayTick}
            stroke={AXIS_STROKE}
            tick={{ fill: AXIS_STROKE, fontSize: 12 }}
            tickLine={false}
            axisLine={false}
            minTickGap={32}
          />
          <YAxis
            width={48}
            stroke={AXIS_STROKE}
            tick={{ fill: AXIS_STROKE, fontSize: 12 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={formatValue}
            allowDecimals={false}
          />
          <Tooltip
            formatter={(value: number) => [formatValue(value), null]}
            labelFormatter={formatDayTick}
            contentStyle={{
              background: "hsl(var(--surface))",
              border: "1px solid hsl(var(--border))",
              borderRadius: "0.5rem",
              color: "hsl(var(--foreground))",
              fontSize: "0.8125rem",
            }}
            labelStyle={{ color: "hsl(var(--muted))" }}
          />
          <Area
            type="monotone"
            dataKey={dataKey}
            stroke="currentColor"
            strokeWidth={2}
            fill={`url(#dashboard-fill-${dataKey})`}
            activeDot={{ r: 4, stroke: "currentColor", strokeWidth: 2, fill: "hsl(var(--surface))" }}
            dot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
