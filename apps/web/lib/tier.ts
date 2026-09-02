import { z } from "zod";

/**
 * Client-safe tier helpers: the form schema mirrors the API's tier body
 * (`createBodySchema` in apps/api/src/routes/tiers.ts) so the browser rejects
 * the same input the server would, and small currency-aware money helpers for
 * turning a minor-unit integer into something a person types and reads.
 *
 * No `next/headers` / server-only imports here — imported by client components.
 */

export const TIER_NAME_MAX = 640;
export const TIER_DESCRIPTION_MAX = 10_000;

/**
 * The currencies the tier form offers. The API accepts any lowercase ISO-4217
 * code (`/^[a-z]{3}$/`); this is just the UI's short list and can grow.
 */
export const SUPPORTED_CURRENCIES = ["usd", "eur", "gbp"] as const;
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

export const CURRENCY_LABELS: Record<SupportedCurrency, string> = {
  usd: "USD — US dollar",
  eur: "EUR — Euro",
  gbp: "GBP — Pound sterling",
};

/** Validated shape submitted to `POST`/`PATCH /creators/me/tiers`. */
export const tierFormSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Give the tier a name.")
    .max(TIER_NAME_MAX, `Keep the name under ${TIER_NAME_MAX} characters.`),
  description: z
    .string()
    .trim()
    .max(TIER_DESCRIPTION_MAX, `Keep the description under ${TIER_DESCRIPTION_MAX.toLocaleString()} characters.`)
    .optional(),
  priceCents: z
    .number({ invalid_type_error: "Enter a price." })
    .int("Enter a valid price.")
    .positive("The price must be greater than zero."),
  currency: z.enum(SUPPORTED_CURRENCIES, { errorMap: () => ({ message: "Choose a currency." }) }),
});

export type TierFormValues = z.infer<typeof tierFormSchema>;

function fractionDigits(currency: string): number {
  try {
    return (
      new Intl.NumberFormat(undefined, { style: "currency", currency: currency.toUpperCase() }).resolvedOptions()
        .maximumFractionDigits ?? 2
    );
  } catch {
    return 2;
  }
}

/** `500, "usd"` → `"$5.00"`; `500, "jpy"` → `"¥500"`. */
export function formatPrice(minorUnits: number, currency: string): string {
  const digits = fractionDigits(currency);
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(minorUnits / 10 ** digits);
  } catch {
    return `${(minorUnits / 10 ** digits).toFixed(digits)} ${currency.toUpperCase()}`;
  }
}

/** `500, "usd"` → `"5.00"` — for pre-filling the price input in major units. */
export function minorUnitsToAmount(minorUnits: number, currency: string): string {
  const digits = fractionDigits(currency);
  return (minorUnits / 10 ** digits).toFixed(digits);
}

/**
 * `"5", "usd"` → `500`. Returns `null` for anything that isn't a non-negative
 * decimal number with at most the currency's precision (e.g. `"5.999"` for USD,
 * `"-1"`, `"abc"`, `""`).
 */
export function amountToMinorUnits(amount: string, currency: string): number | null {
  const trimmed = amount.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const digits = fractionDigits(currency);
  const [, decimals = ""] = trimmed.split(".");
  if (decimals.length > digits) return null;
  const value = Math.round(Number(trimmed) * 10 ** digits);
  return Number.isFinite(value) ? value : null;
}
