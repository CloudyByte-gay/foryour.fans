"use client";

import { ImagePlus } from "lucide-react";
import { useState } from "react";
import {
  Button,
  Card,
  CardContent,
  FormField,
  FormControl,
  FormLabel,
  FormDescription,
  Select,
  Textarea,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  toast,
} from "@/components/ui";
import { apiFetch } from "@/lib/apiFetch";
import { csrfHeaders } from "@/lib/csrf";
import { BSKY_POST_MAX_GRAPHEMES, bskyFitProblems, graphemeLength } from "@/lib/bskyPost";
import type { FullPost, PostVisibility } from "@/lib/post";

const PUBLIC_COPY = "Publishes to Bluesky-compatible feeds and your foryour.fans record.";
const GATED_COPY =
  "Subscriber-only content is encrypted and is not published as a normal public Bluesky post.";

function splitList(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function PostComposer({
  tiers,
  onCreated,
}: {
  tiers: Array<{ id: string; name: string }>;
  onCreated: (post: FullPost) => void;
}) {
  const [visibility, setVisibility] = useState<PostVisibility>("PUBLIC");
  const [text, setText] = useState("");
  const [tierId, setTierId] = useState<string>(tiers[0]?.id ?? "");
  const [langsRaw, setLangsRaw] = useState("");
  const [tagsRaw, setTagsRaw] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const isPublic = visibility === "PUBLIC";
  const langs = splitList(langsRaw);
  const tags = splitList(tagsRaw);
  const graphemes = graphemeLength(text);

  const problems = isPublic ? bskyFitProblems({ text, langs, tags }) : [];

  const emptyText = text.trim().length === 0;
  const missingTier = visibility === "TIER" && !tierId;
  const canSubmit = !submitting && !emptyText && !missingTier && problems.length === 0;

  async function submit() {
    setSubmitting(true);
    setServerError(null);
    try {
      const res = await apiFetch("/creators/me/posts", {
        method: "POST",
        headers: { "content-type": "application/json", ...csrfHeaders() },
        body: JSON.stringify({
          visibility,
          text: text.trim(),
          ...(visibility === "TIER" ? { minimumTierId: tierId } : {}),
          ...(isPublic && langs.length > 0 ? { langs } : {}),
          ...(isPublic && tags.length > 0 ? { tags } : {}),
        }),
      });
      if (res.status === 201) {
        onCreated((await res.json()) as FullPost);
        setText("");
        setLangsRaw("");
        setTagsRaw("");
        toast({ title: isPublic ? "Posted to your feeds" : "Posted for subscribers" });
        return;
      }
      if (res.status === 502) {
        setServerError("Publishing to the AT Protocol network failed. Nothing was saved — try again.");
        return;
      }
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      setServerError(body?.error?.message ?? "Could not create the post.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardContent className="space-y-4 py-4">
        <FormField>
          <FormLabel>Visibility</FormLabel>
          <FormControl>
            <Select value={visibility} onChange={(e) => setVisibility(e.target.value as PostVisibility)}>
              <option value="PUBLIC">Public</option>
              <option value="SUBSCRIBERS">Subscribers</option>
              <option value="TIER">Specific tier</option>
            </Select>
          </FormControl>
          <FormDescription>{isPublic ? PUBLIC_COPY : GATED_COPY}</FormDescription>
        </FormField>

        {visibility === "TIER" && (
          <FormField>
            <FormLabel>Minimum tier</FormLabel>
            <FormControl>
              <Select value={tierId} onChange={(e) => setTierId(e.target.value)}>
                <option value="" disabled>
                  Choose a tier…
                </option>
                {tiers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </FormControl>
          </FormField>
        )}

        <FormField>
          <div className="flex items-center justify-between">
            <FormLabel>Post</FormLabel>
            {isPublic && (
              <span
                className={
                  graphemes > BSKY_POST_MAX_GRAPHEMES ? "text-xs text-danger" : "text-xs text-muted"
                }
                data-testid="grapheme-counter"
              >
                {graphemes} / {BSKY_POST_MAX_GRAPHEMES}
              </span>
            )}
          </div>
          <FormControl>
            <Textarea
              rows={4}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={isPublic ? "Say something to the open network…" : "For your subscribers…"}
            />
          </FormControl>
          {isPublic && (
            <FormDescription>Links and @mentions are detected automatically.</FormDescription>
          )}
        </FormField>

        {isPublic && (
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField>
              <FormLabel>Languages</FormLabel>
              <FormControl>
                <input
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  value={langsRaw}
                  onChange={(e) => setLangsRaw(e.target.value)}
                  placeholder="en, ja"
                />
              </FormControl>
              <FormDescription>Comma-separated BCP-47 codes. Up to 3.</FormDescription>
            </FormField>
            <FormField>
              <FormLabel>Tags</FormLabel>
              <FormControl>
                <input
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                  value={tagsRaw}
                  onChange={(e) => setTagsRaw(e.target.value)}
                  placeholder="art, photography"
                />
              </FormControl>
              <FormDescription>Comma-separated. Up to 8.</FormDescription>
            </FormField>
          </div>
        )}

        <div className="flex items-center gap-3">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button type="button" variant="ghost" size="sm" disabled>
                    <ImagePlus className="h-4 w-4" aria-hidden />
                    Add media
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>Media on public posts is coming soon.</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        {problems.length > 0 && (
          <ul className="space-y-1 text-sm text-danger" data-testid="bsky-problems">
            {problems.map((p) => (
              <li key={p.message}>{p.message}</li>
            ))}
          </ul>
        )}
        {serverError && <p className="text-sm text-danger">{serverError}</p>}

        <div className="flex justify-end">
          <Button onClick={submit} disabled={!canSubmit} aria-label="Publish post">
            {submitting ? "Publishing…" : isPublic ? "Publish to Bluesky + foryour.fans" : "Post for subscribers"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
