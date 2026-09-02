"use client";

import { AlertTriangle, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import {
  Button,
  FormField,
  FormControl,
  FormLabel,
  Select,
  Textarea,
  toast,
} from "@/components/ui";
import {
  POST_TEXT_MAX,
  POST_VISIBILITY_META,
  PUBLIC_POST_WARNING,
  VISIBILITY_ORDER,
  createPost,
  postFormSchema,
  updatePost,
  type OwnPost,
  type PostVisibility,
  type TierOption,
} from "@/lib/post";
import { formatPrice } from "@/lib/tier";

type Mode = "create" | "edit";

export function PostComposer({
  mode,
  post,
  tiers,
}: {
  mode: Mode;
  post?: OwnPost;
  /** The creator's tiers (`GET /creators/me/tiers`) — active ones are selectable for `TIER`. */
  tiers: TierOption[];
}) {
  const router = useRouter();
  const groupName = useId();

  const [visibility, setVisibility] = useState<PostVisibility>(post?.visibility ?? "SUBSCRIBERS");
  const [minimumTierId, setMinimumTierId] = useState<string>(post?.minimumTierId ?? "");
  const [text, setText] = useState(post?.text ?? "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [rootError, setRootError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const activeTiers = tiers.filter((t) => t.isActive);
  // An edit can reference a since-deactivated tier — keep it selectable so the
  // form round-trips, but only if it's the one already on the post.
  const selectableTiers = activeTiers.some((t) => t.id === minimumTierId)
    ? activeTiers
    : [...activeTiers, ...tiers.filter((t) => t.id === minimumTierId)];
  const noTiers = activeTiers.length === 0 && !minimumTierId;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    setRootError(null);

    const parsed = postFormSchema.safeParse({
      visibility,
      minimumTierId: visibility === "TIER" ? minimumTierId || undefined : undefined,
      text,
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
    const outcome =
      mode === "create"
        ? await createPost(parsed.data)
        : await updatePost(post!.id, parsed.data);

    if (outcome.ok) {
      toast({
        title: mode === "create" ? "Post published" : "Post updated",
        description:
          parsed.data.visibility === "PUBLIC"
            ? "It's live and synced to the AT Protocol network."
            : "Only your subscribers can see it.",
      });
      router.push("/creator/posts");
      router.refresh();
      return;
    }

    setSaving(false);
    setRootError(outcome.message);
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href="/creator/posts">
            <ArrowLeft className="h-4 w-4" aria-hidden />
            All posts
          </Link>
        </Button>
        <h1 className="mt-2 font-display text-2xl font-bold tracking-tight">
          {mode === "create" ? "New post" : "Edit post"}
        </h1>
      </div>

      <form onSubmit={onSubmit} className="space-y-6">
        <FormField error={errors.text}>
          <FormLabel>Post</FormLabel>
          <FormControl>
            <Textarea
              value={text}
              rows={8}
              maxLength={POST_TEXT_MAX}
              autoFocus
              placeholder="Write your post…"
              onChange={(e) => setText(e.target.value)}
            />
          </FormControl>
          <p className="mt-1 text-xs text-muted">
            Plain text. Line breaks are kept. {text.length.toLocaleString()}/{POST_TEXT_MAX.toLocaleString()}
          </p>
        </FormField>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Who can see this</legend>
          <div className="space-y-2">
            {VISIBILITY_ORDER.map((value) => {
              const meta = POST_VISIBILITY_META[value];
              const checked = visibility === value;
              return (
                <label
                  key={value}
                  className={`flex cursor-pointer gap-3 rounded-lg border p-3 text-sm transition-colors ${
                    checked ? "border-primary bg-primary/5" : "border-border hover:bg-surface-muted"
                  }`}
                >
                  <input
                    type="radio"
                    name={groupName}
                    value={value}
                    checked={checked}
                    onChange={() => setVisibility(value)}
                    aria-label={meta.label}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                  />
                  <span>
                    <span className="font-medium">{meta.label}</span>
                    <span className="block text-muted">{meta.hint}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        {visibility === "PUBLIC" && (
          <p
            role="note"
            className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-foreground"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
            <span>{PUBLIC_POST_WARNING}</span>
          </p>
        )}

        {visibility === "TIER" && (
          <FormField error={errors.minimumTierId}>
            <FormLabel>Unlocking tier</FormLabel>
            {noTiers ? (
              <p className="rounded-md border border-border bg-surface-muted p-3 text-sm text-muted">
                You don&rsquo;t have any active tiers yet.{" "}
                <Link href="/creator/tiers" className="text-primary hover:underline">
                  Create one first
                </Link>
                , then come back to gate this post.
              </p>
            ) : (
              <FormControl>
                <Select value={minimumTierId} onChange={(e) => setMinimumTierId(e.target.value)}>
                  <option value="">Choose a tier…</option>
                  {selectableTiers.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} — {formatPrice(t.priceCents, t.currency)}/mo
                      {t.isActive ? "" : " (deactivated)"}
                    </option>
                  ))}
                </Select>
              </FormControl>
            )}
            <p className="mt-1 text-xs text-muted">
              Subscribers at this tier or any higher tier can see the post.
            </p>
          </FormField>
        )}

        <div className="rounded-lg border border-dashed border-border p-4">
          <p className="text-sm font-medium">Attachments</p>
          <p className="mt-1 text-sm text-muted">
            Photo and video uploads arrive in the next release. For now, posts are text only.
          </p>
          <input type="file" multiple disabled className="mt-2 text-sm text-muted" aria-label="Attachments (coming soon)" />
        </div>

        {rootError && (
          <p role="alert" className="text-sm font-medium text-danger">
            {rootError}
          </p>
        )}

        <div className="flex items-center justify-end gap-3">
          <Button asChild type="button" variant="ghost">
            <Link href="/creator/posts">Cancel</Link>
          </Button>
          <Button type="submit" loading={saving}>
            {mode === "create" ? "Publish" : "Save changes"}
          </Button>
        </div>
      </form>
    </div>
  );
}
