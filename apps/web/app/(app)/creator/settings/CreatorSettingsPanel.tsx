"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  FormControl,
  FormField,
  FormLabel,
  Input,
  Textarea,
  toast,
} from "@/components/ui";
import { apiFetch } from "@/lib/apiFetch";
import { csrfHeaders } from "@/lib/csrf";
import { relativeTime } from "@/lib/format";
import type { OwnCreator } from "./page";
import { SlugChangeDialog } from "./SlugChangeDialog";

export function CreatorSettingsPanel({ creator }: { creator: OwnCreator }) {
  const router = useRouter();
  const [form, setForm] = useState({
    displayName: creator.displayName ?? "",
    bio: creator.bio ?? "",
    website: creator.website ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState(creator.updatedAt);

  const badWebsite = form.website.trim().length > 0 && !/^https?:\/\/\S+\.\S+/.test(form.website.trim());

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (badWebsite) return;
    setSaving(true);
    try {
      const res = await apiFetch("/creators/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...csrfHeaders() },
        body: JSON.stringify({
          displayName: form.displayName.trim(),
          bio: form.bio.trim(),
          website: form.website.trim(),
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        const message =
          res.status === 502
            ? "Saved locally, but publishing to your PDS failed. Try again."
            : (body?.error?.message ?? "Couldn't save your changes.");
        toast({ title: "Save failed", description: message, variant: "error" });
        return;
      }
      const updated = (await res.json()) as OwnCreator;
      setLastSaved(updated.updatedAt);
      toast({ title: "Profile published to your PDS", variant: "success" });
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Public profile</CardTitle>
          <CardDescription>
            Saved as a <code>dev.creator.profile</code> record on your PDS — public on the AT
            Protocol network. Last saved {relativeTime(lastSaved)}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={save} className="space-y-4">
            <FormField>
              <FormLabel optional>Display name</FormLabel>
              <FormControl>
                <Input
                  value={form.displayName}
                  maxLength={640}
                  onChange={(e) => setForm((f) => ({ ...f, displayName: e.target.value }))}
                />
              </FormControl>
            </FormField>
            <FormField>
              <FormLabel optional>Bio</FormLabel>
              <FormControl>
                <Textarea
                  value={form.bio}
                  rows={4}
                  maxLength={20000}
                  onChange={(e) => setForm((f) => ({ ...f, bio: e.target.value }))}
                />
              </FormControl>
            </FormField>
            <FormField error={badWebsite ? "Enter a full URL, e.g. https://example.com" : undefined}>
              <FormLabel optional>Website</FormLabel>
              <FormControl>
                <Input
                  type="url"
                  value={form.website}
                  maxLength={2048}
                  aria-invalid={badWebsite}
                  onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))}
                />
              </FormControl>
            </FormField>
            <div className="flex items-center gap-3">
              <Button type="submit" loading={saving} disabled={badWebsite}>
                Save &amp; publish
              </Button>
              <Button asChild variant="ghost" size="sm">
                <Link href={`/c/${creator.slug}`}>View your page</Link>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Avatar &amp; banner</CardTitle>
          <CardDescription>Not available yet.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted">
            Image upload lands with media support. Your avatar and banner will be uploaded as blobs
            to your own PDS and referenced from your <code>dev.creator.profile</code> record.
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Page address</CardTitle>
          <CardDescription>
            Your page is <span className="font-mono">/c/{creator.slug}</span>.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <SlugChangeDialog currentSlug={creator.slug} />
          <p className="text-sm text-muted">
            Changing it breaks existing links and is limited to once every 7 days.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
