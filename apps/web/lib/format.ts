/** "March 2025" — for "member since" style labels. */
export function monthYear(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

/** "4 Mar 2025" — for renewal / expiry dates. */
export function shortDate(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** "just now" / "3 minutes ago" / "2 days ago" / "on 4 Mar 2025". */
export function relativeTime(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "";
  const secondsAgo = Math.round((Date.now() - d.getTime()) / 1000);

  if (secondsAgo < 45) return "just now";
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["minute", 60],
    ["hour", 3600],
    ["day", 86400],
  ];
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  for (const [unit, seconds] of units) {
    if (secondsAgo < seconds * (unit === "day" ? 7 : 60)) {
      return rtf.format(-Math.round(secondsAgo / seconds), unit);
    }
  }
  return `on ${d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`;
}
