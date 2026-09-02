"use client";

import { AlertTriangle } from "lucide-react";
import { useId } from "react";
import {
  Button,
  Checkbox,
  FormControl,
  FormField,
  FormLabel,
  Input,
  Switch,
  Textarea,
} from "@/components/ui";

export interface WizardData {
  displayName: string;
  bio: string;
  website: string;
  ageConfirmed: boolean;
  willPostAdult: boolean;
}

function StepNav({
  onBack,
  next,
  nextDisabled,
  submitting,
}: {
  onBack?: () => void;
  next: string;
  nextDisabled?: boolean;
  submitting?: boolean;
}) {
  return (
    <div className={onBack ? "flex justify-between" : "flex justify-end"}>
      {onBack && (
        <Button type="button" variant="ghost" onClick={onBack} disabled={submitting}>
          Back
        </Button>
      )}
      <Button type="submit" disabled={nextDisabled} loading={submitting}>
        {next}
      </Button>
    </div>
  );
}

export function ProfileStep({
  value,
  onChange,
  onNext,
}: {
  value: WizardData;
  onChange: (patch: Partial<WizardData>) => void;
  onNext: () => void;
}) {
  const badWebsite =
    value.website.trim().length > 0 && !/^https?:\/\/\S+\.\S+/.test(value.website.trim());

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!badWebsite) onNext();
      }}
      className="space-y-6"
    >
      <div>
        <h2 className="font-display text-xl font-semibold">Your public profile</h2>
        <p className="mt-1 text-sm text-muted">
          This is published to your PDS as a <code>fans.foryour.profile</code> record — it&rsquo;s
          public on the AT Protocol network. All fields are optional.
        </p>
      </div>

      <FormField>
        <FormLabel optional>Display name</FormLabel>
        <FormControl>
          <Input
            value={value.displayName}
            maxLength={640}
            onChange={(e) => onChange({ displayName: e.target.value })}
            placeholder="How you want to be known"
          />
        </FormControl>
      </FormField>

      <FormField>
        <FormLabel optional>Bio</FormLabel>
        <FormControl>
          <Textarea
            value={value.bio}
            maxLength={20000}
            rows={4}
            onChange={(e) => onChange({ bio: e.target.value })}
            placeholder="Tell people what you make"
          />
        </FormControl>
      </FormField>

      <FormField error={badWebsite ? "Enter a full URL, e.g. https://example.com" : undefined}>
        <FormLabel optional>Website</FormLabel>
        <FormControl>
          <Input
            type="url"
            value={value.website}
            maxLength={2048}
            onChange={(e) => onChange({ website: e.target.value })}
            placeholder="https://example.com"
            aria-invalid={badWebsite}
          />
        </FormControl>
      </FormField>

      <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted">
        Avatar and banner images come with media support in a later release — you&rsquo;ll be able
        to add them from creator settings then.
      </div>

      <StepNav next="Continue" nextDisabled={badWebsite} />
    </form>
  );
}

export function RatingStep({
  value,
  onChange,
  onNext,
  onBack,
}: {
  value: WizardData;
  onChange: (patch: Partial<WizardData>) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const ageId = useId();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onNext();
      }}
      className="space-y-6"
    >
      <div>
        <h2 className="font-display text-xl font-semibold">Content rating</h2>
        <p className="mt-1 text-sm text-muted">
          foryour.fans supports adult creators. Tell us whether this account will post adult
          content so it can be gated appropriately.
        </p>
      </div>

      <label htmlFor={ageId} className="flex items-start gap-3">
        <Checkbox
          id={ageId}
          checked={value.ageConfirmed}
          onCheckedChange={(c) =>
            onChange({ ageConfirmed: c === true, willPostAdult: c === true && value.willPostAdult })
          }
        />
        <span className="text-sm">I confirm that I am at least 18 years old.</span>
      </label>

      <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-4">
        <div>
          <p className="text-sm font-medium">This account will post adult content</p>
          <p className="text-sm text-muted">Requires the 18+ confirmation above.</p>
        </div>
        <Switch
          checked={value.willPostAdult}
          disabled={!value.ageConfirmed}
          onCheckedChange={(c) => onChange({ willPostAdult: c })}
          aria-label="This account will post adult content"
        />
      </div>

      <div className="flex gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
        <p>
          <strong className="font-semibold">Placeholder.</strong> This choice isn&rsquo;t saved yet.
          A real content-rating flag, plus the identity / age verification that will be{" "}
          <strong className="font-medium">required before payouts and before posting adult
          content</strong>, arrive in a later release.
        </p>
      </div>

      <StepNav onBack={onBack} next="Continue" />
    </form>
  );
}

function ReviewRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap justify-between gap-x-4 gap-y-0.5 py-2">
      <span className="text-sm text-muted">{label}</span>
      <span className="text-sm">{children}</span>
    </div>
  );
}

export function ReviewStep({
  value,
  pageAddress,
  onBack,
  onSubmit,
  submitting,
  error,
}: {
  value: WizardData;
  pageAddress: string;
  onBack: () => void;
  onSubmit: () => void;
  submitting: boolean;
  error: string | null;
}) {
  const none = <span className="text-muted">—</span>;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      className="space-y-6"
    >
      <div>
        <h2 className="font-display text-xl font-semibold">Review &amp; publish</h2>
        <p className="mt-1 text-sm text-muted">
          Check everything, then publish your creator account. Your page will be{" "}
          <span className="font-mono">/c/{pageAddress}</span> — it follows your AT Protocol handle,
          and <span className="font-mono">/c/&lt;your-did&gt;</span> always works too.
        </p>
      </div>

      <div className="divide-y divide-border rounded-lg border border-border px-4">
        <ReviewRow label="Page">
          <span className="font-mono">/c/{pageAddress}</span>
        </ReviewRow>
        <ReviewRow label="Display name">{value.displayName || none}</ReviewRow>
        <ReviewRow label="Bio">{value.bio ? `${value.bio.slice(0, 80)}${value.bio.length > 80 ? "…" : ""}` : none}</ReviewRow>
        <ReviewRow label="Website">{value.website || none}</ReviewRow>
        <ReviewRow label="Adult content">{value.willPostAdult ? "Yes (not saved yet)" : "No"}</ReviewRow>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1 rounded-lg border border-border p-4">
          <p className="text-sm font-medium">Published to the AT Protocol network</p>
          <p className="text-xs text-muted">
            A <code>fans.foryour.profile</code> record on your PDS: display name, bio, website. Public
            and portable — other AT Protocol apps can read it.
          </p>
        </div>
        <div className="space-y-1 rounded-lg border border-border p-4">
          <p className="text-sm font-medium">Stored by foryour.fans</p>
          <p className="text-xs text-muted">
            Your account status. Your page address just follows your AT Protocol handle — nothing
            app-owned. Not written to the public network.
          </p>
        </div>
      </div>

      <p className="text-xs text-muted">
        Not included yet: avatar &amp; banner (needs media support) and the adult-content flag /
        verification (a later release).
      </p>

      {error && (
        <p role="alert" className="flex gap-2 rounded-md border border-danger/40 bg-danger/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden />
          <span>{error}</span>
        </p>
      )}

      <StepNav onBack={onBack} next="Publish creator account" submitting={submitting} />
    </form>
  );
}
