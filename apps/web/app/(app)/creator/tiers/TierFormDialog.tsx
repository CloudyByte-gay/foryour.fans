"use client";

import Link from "next/link";
import { useState } from "react";
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FormControl,
  FormField,
  FormLabel,
  Input,
  Select,
  Textarea,
} from "@/components/ui";
import { apiFetch } from "@/lib/apiFetch";
import { csrfHeaders } from "@/lib/csrf";
import {
  CURRENCY_LABELS,
  SUPPORTED_CURRENCIES,
  TIER_DESCRIPTION_MAX,
  TIER_NAME_MAX,
  amountToMinorUnits,
  minorUnitsToAmount,
  tierFormSchema,
  type SupportedCurrency,
} from "@/lib/tier";
import type { OwnTier } from "./page";

type Mode = "create" | "edit";

interface ApiError {
  error?: { message?: string; statusCode?: number };
}

function seedCurrency(tier: OwnTier | null): SupportedCurrency {
  const found = SUPPORTED_CURRENCIES.find((c) => c === tier?.currency);
  return found ?? "usd";
}

export function TierFormDialog({
  open,
  mode,
  tier,
  isVerified,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  mode: Mode;
  tier: OwnTier | null;
  /** WEB PHASE 14 — whether the creator's `verificationStatus` is VERIFIED; gates the "contains adult content" checkbox. */
  isVerified: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (tier: OwnTier) => void;
}) {
  const [name, setName] = useState(tier?.name ?? "");
  const [description, setDescription] = useState(tier?.description ?? "");
  const [currency, setCurrency] = useState<SupportedCurrency>(seedCurrency(tier));
  const [price, setPrice] = useState(
    tier ? minorUnitsToAmount(tier.priceCents, tier.currency) : "",
  );
  const [containsAdultContent, setContainsAdultContent] = useState(tier?.containsAdultContent ?? false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [rootError, setRootError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const priceChanged = mode === "edit" && tier !== null && amountToMinorUnits(price, currency) !== tier.priceCents;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    setRootError(null);

    const priceCents = amountToMinorUnits(price, currency);
    if (priceCents === null) {
      setErrors({ price: "Enter a price like 4.99." });
      return;
    }

    const parsed = tierFormSchema.safeParse({
      name,
      description: description.trim() || undefined,
      priceCents,
      currency,
      containsAdultContent: isVerified ? containsAdultContent : undefined,
    });
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0] ?? "root");
        next[key] ??= issue.message;
      }
      setErrors(next);
      return;
    }

    setSaving(true);
    try {
      const path = mode === "create" ? "/creators/me/tiers" : `/creators/me/tiers/${tier!.id}`;
      const res = await apiFetch(path, {
        method: mode === "create" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json", ...csrfHeaders() },
        body: JSON.stringify(parsed.data),
      });

      if (res.ok) {
        onSaved((await res.json()) as OwnTier);
        return;
      }

      if (res.status === 502) {
        setRootError("Saved, but publishing to the AT Protocol network failed. Try again.");
        return;
      }
      const body = (await res.json().catch(() => null)) as ApiError | null;
      setRootError(body?.error?.message ?? "Couldn't save the tier.");
    } catch {
      setRootError("We couldn't reach foryour.fans. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "New tier" : `Edit “${tier?.name}”`}</DialogTitle>
          <DialogDescription>
            Name, monthly price, and what subscribers get. Public tier metadata is synced to the AT
            Protocol network.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <FormField error={errors.name}>
            <FormLabel>Name</FormLabel>
            <FormControl>
              <Input
                value={name}
                maxLength={TIER_NAME_MAX}
                onChange={(e) => setName(e.target.value)}
              />
            </FormControl>
          </FormField>

          <FormField error={errors.description}>
            <FormLabel optional>Description</FormLabel>
            <FormControl>
              <Textarea
                value={description}
                rows={3}
                maxLength={TIER_DESCRIPTION_MAX}
                onChange={(e) => setDescription(e.target.value)}
              />
            </FormControl>
          </FormField>

          <div className="grid grid-cols-[1fr_9rem] gap-3">
            <FormField error={errors.price}>
              <FormLabel>Price / month</FormLabel>
              <FormControl>
                <Input
                  inputMode="decimal"
                  placeholder="4.99"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                />
              </FormControl>
            </FormField>
            <FormField error={errors.currency}>
              <FormLabel>Currency</FormLabel>
              <FormControl>
                <Select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value as SupportedCurrency)}
                >
                  {SUPPORTED_CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {CURRENCY_LABELS[c]}
                    </option>
                  ))}
                </Select>
              </FormControl>
            </FormField>
          </div>

          {priceChanged && (
            <p role="note" className="rounded-md border border-border bg-surface-muted p-3 text-sm text-muted">
              Changing the price does <strong>not</strong> change what current subscribers pay — they
              keep the price they signed up at. This only affects new subscriptions.
            </p>
          )}

          {isVerified ? (
            <label htmlFor="tier-adult-content" className="flex items-start gap-3">
              <Checkbox
                id="tier-adult-content"
                checked={containsAdultContent}
                onCheckedChange={(c) => setContainsAdultContent(c === true)}
              />
              <span className="text-sm">
                This tier contains adult content
                <span className="block text-muted">Subscribers see an 18+ badge and an age gate before viewing.</span>
              </span>
            </label>
          ) : (
            <p className="rounded-md border border-border bg-surface-muted p-3 text-sm text-muted">
              Marking a tier as adult content requires creator identity verification.{" "}
              <Link href="/creator/verification" className="text-primary hover:underline">
                Verify your identity
              </Link>
              .
            </p>
          )}

          {rootError && (
            <p role="alert" className="text-sm font-medium text-danger">
              {rootError}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              {mode === "create" ? "Create tier" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
