"use client";

import { AlertTriangle, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import {
  Button,
  Checkbox,
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
import {
  BSKY_POST_MAX_GRAPHEMES,
  bskyFitProblems,
  graphemeLength,
} from "@/lib/bskyPost";
import { formatPrice } from "@/lib/tier";
import { MediaUploader } from "@/components/media/MediaUploader";
import {
  allReady,
  attachmentsToRefs,
  mediaKind,
  type Attachment,
} from "@/lib/media";

type Mode = "create" | "edit";

/** Edit mode: rebuild the uploader's rows from the post's already-attached (READY) media. */
function seedAttachments(post?: OwnPost): Attachment[] {
  return (post?.media ?? [])
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((m) => ({
      localId: `seed-${m.mediaAssetId}`,
      assetId: m.mediaAssetId,
      status: "ready" as const,
      progress: 1,
      kind: mediaKind(m.mimeType) ?? "image",
      mimeType: m.mimeType,
      name: "Attachment",
      size: 0,
      previewUrl: null,
      width: m.width ?? undefined,
      height: m.height ?? undefined,
      durationSeconds: m.durationSeconds ?? undefined,
    }));
}

export function PostComposer({
  mode,
  post,
  tiers,
  isVerified,
}: {
  mode: Mode;
  post?: OwnPost;
  /** The creator's tiers (`GET /creators/me/tiers`) — active ones are selectable for `TIER`. */
  tiers: TierOption[];
  /** WEB PHASE 14 — whether the creator's `verificationStatus` is VERIFIED; gates the "contains adult content" checkbox. */
  isVerified: boolean;
}) {
  const router = useRouter();
  const groupName = useId();

  const [visibility, setVisibility] = useState<PostVisibility>(
    post?.visibility ?? "SUBSCRIBERS",
  );
  const [minimumTierId, setMinimumTierId] = useState<string>(
    post?.minimumTierId ?? "",
  );
  const [text, setText] = useState(post?.text ?? "");
  const [attachments, setAttachments] = useState<Attachment[]>(() =>
    seedAttachments(post),
  );
  const [containsAdultContent, setContainsAdultContent] = useState(
    post?.containsAdultContent ?? false,
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [rootError, setRootError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const attachmentsReady = allReady(attachments);

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

    if (!attachmentsReady) {
      setRootError("Hang on — some attachments are still uploading.");
      return;
    }

    const parsed = postFormSchema.safeParse({
      visibility,
      minimumTierId:
        visibility === "TIER" ? minimumTierId || undefined : undefined,
      text,
      media: attachmentsToRefs(attachments),
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

    // A PUBLIC post is also written as a normal app.bsky.feed.post
    // (prompts/bluesky-public-posts.md) — it must fit Bluesky's rules.
    if (parsed.data.visibility === "PUBLIC") {
      const problems = bskyFitProblems({ text: parsed.data.text });
      if (problems.length > 0) {
        setErrors({ text: problems[0]!.message });
        return;
      }
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
            ? "It's live and synced to Bluesky's network."
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
              // WEB PHASE 15 — deliberate: this composer is a whole dedicated
              // page (not existing content the visitor might be reading), so
              // jumping straight into the text field is the same accepted
              // pattern most compose UIs use, not the "surprise focus theft
              // on a content page" jsx-a11y/no-autofocus otherwise guards
              // against. The page's own <h1> is still announced via the
              // document title/route change (see RouteFocusManager).
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
              placeholder="Write your post…"
              onChange={(e) => setText(e.target.value)}
            />
          </FormControl>
          <p className="mt-1 text-xs text-muted">
            Plain text. Line breaks are kept. {text.length.toLocaleString()}/
            {POST_TEXT_MAX.toLocaleString()}
          </p>
          {visibility === "PUBLIC" && (
            <p
              className={
                graphemeLength(text) > BSKY_POST_MAX_GRAPHEMES
                  ? "mt-1 text-xs text-danger"
                  : "mt-1 text-xs text-muted"
              }
              data-testid="grapheme-counter"
            >
              Bluesky limit: {graphemeLength(text)} / {BSKY_POST_MAX_GRAPHEMES}{" "}
              characters. Links and @mentions are detected automatically.
            </p>
          )}
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
                    checked
                      ? "border-primary bg-primary/5"
                      : "border-border hover:bg-surface-muted"
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
            <AlertTriangle
              className="mt-0.5 h-4 w-4 shrink-0 text-warning"
              aria-hidden
            />
            <span>{PUBLIC_POST_WARNING}</span>
          </p>
        )}

        {visibility === "TIER" && (
          <FormField error={errors.minimumTierId}>
            <FormLabel>Unlocking tier</FormLabel>
            {noTiers ? (
              <p className="rounded-md border border-border bg-surface-muted p-3 text-sm text-muted">
                You don&rsquo;t have any active tiers yet.{" "}
                <Link
                  href="/creator/tiers"
                  className="text-primary hover:underline"
                >
                  Create one first
                </Link>
                , then come back to gate this post.
              </p>
            ) : (
              <FormControl>
                <Select
                  value={minimumTierId}
                  onChange={(e) => setMinimumTierId(e.target.value)}
                >
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

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Attachments</legend>
          <p className="text-xs text-muted">
            {visibility === "PUBLIC"
              ? "Public-post media is served from foryour.fans and can be viewed by anyone."
              : "Only people who can see this post can load its media."}
          </p>
          <MediaUploader
            value={attachments}
            onChange={setAttachments}
            disabled={saving}
          />
        </fieldset>

        {isVerified ? (
          <label
            htmlFor="post-adult-content"
            className="flex items-start gap-3"
          >
            <Checkbox
              id="post-adult-content"
              checked={containsAdultContent}
              onCheckedChange={(c) => setContainsAdultContent(c === true)}
            />
            <span className="text-sm">
              This post contains adult content
              <span className="block text-muted">
                Viewers see an 18+ badge and an age gate before viewing.
              </span>
            </span>
          </label>
        ) : (
          <p className="rounded-md border border-border bg-surface-muted p-3 text-sm text-muted">
            Marking a post as adult content requires creator identity
            verification.{" "}
            <Link
              href="/creator/verification"
              className="text-primary hover:underline"
            >
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

        <div className="flex items-center justify-end gap-3">
          <Button asChild type="button" variant="ghost">
            <Link href="/creator/posts">Cancel</Link>
          </Button>
          <Button type="submit" loading={saving} disabled={!attachmentsReady}>
            {mode === "create" ? "Publish" : "Save changes"}
          </Button>
        </div>
      </form>
    </div>
  );
}
