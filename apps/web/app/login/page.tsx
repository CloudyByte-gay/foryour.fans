"use client";

import { useState, type FormEvent } from "react";

export default function LoginPage() {
  const [handle, setHandle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const response = await fetch("/api/auth/atproto/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handle }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
        throw new Error(body?.error?.message ?? "Could not start sign-in for that handle.");
      }

      const { redirectUrl } = (await response.json()) as { redirectUrl: string };
      window.location.href = redirectUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setLoading(false);
    }
  }

  return (
    <main>
      <h1>Log in</h1>
      <form onSubmit={handleSubmit}>
        <label htmlFor="handle">AT Protocol handle</label>
        <input
          id="handle"
          name="handle"
          placeholder="alice.bsky.social"
          value={handle}
          onChange={(event) => setHandle(event.target.value)}
          autoComplete="username"
          required
        />
        <button type="submit" disabled={loading}>
          {loading ? "Redirecting…" : "Continue with AT Protocol"}
        </button>
      </form>
      {error && <p role="alert">{error}</p>}
    </main>
  );
}
