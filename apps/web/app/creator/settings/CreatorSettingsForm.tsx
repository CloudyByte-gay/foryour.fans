"use client";

import { useState, type FormEvent } from "react";
import { csrfHeaders } from "../../../lib/csrf";

interface Initial {
  slug: string;
  displayName: string | null;
  bio: string | null;
  website: string | null;
}

export function CreatorSettingsForm({ initial }: { initial: Initial }) {
  const [slug, setSlug] = useState(initial.slug);
  const [displayName, setDisplayName] = useState(initial.displayName ?? "");
  const [bio, setBio] = useState(initial.bio ?? "");
  const [website, setWebsite] = useState(initial.website ?? "");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(false);
    setLoading(true);

    try {
      const response = await fetch("/api/creators/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...csrfHeaders() },
        body: JSON.stringify({ slug, displayName, bio, website }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(body?.error?.message ?? "Could not save changes.");
      }

      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <label htmlFor="slug">Slug</label>
      <input id="slug" name="slug" value={slug} onChange={(event) => setSlug(event.target.value)} required />
      <p>Changing your slug is limited to once every 7 days.</p>

      <label htmlFor="displayName">Display name</label>
      <input id="displayName" name="displayName" value={displayName} onChange={(event) => setDisplayName(event.target.value)} />

      <label htmlFor="bio">Bio</label>
      <textarea id="bio" name="bio" value={bio} onChange={(event) => setBio(event.target.value)} />

      <label htmlFor="website">Website</label>
      <input
        id="website"
        name="website"
        type="url"
        placeholder="https://example.com"
        value={website}
        onChange={(event) => setWebsite(event.target.value)}
      />

      <button type="submit" disabled={loading}>
        {loading ? "Saving…" : "Save changes"}
      </button>
      {success && <p role="status">Saved.</p>}
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
