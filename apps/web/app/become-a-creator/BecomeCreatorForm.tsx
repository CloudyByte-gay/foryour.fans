"use client";

import { useState, type FormEvent } from "react";
import { csrfHeaders } from "../../lib/csrf";

export function BecomeCreatorForm() {
  const [slug, setSlug] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [website, setWebsite] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const response = await fetch("/api/creators", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...csrfHeaders() },
        body: JSON.stringify({ slug, displayName, bio, website }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(body?.error?.message ?? "Could not create your creator account.");
      }

      window.location.href = `/c/${slug}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <label htmlFor="slug">Slug (your page will be at /c/your-slug)</label>
      <input
        id="slug"
        name="slug"
        placeholder="your-name"
        value={slug}
        onChange={(event) => setSlug(event.target.value)}
        required
      />

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
        {loading ? "Creating…" : "Create creator account"}
      </button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
