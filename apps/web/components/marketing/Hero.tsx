import Link from "next/link";
import { Button } from "@/components/ui";

/** Logged-out hero for `/`. */
export function Hero() {
  return (
    <section className="mx-auto max-w-3xl px-4 py-20 text-center sm:py-28">
      <p className="text-sm font-medium uppercase tracking-wide text-primary">
        Built on Bluesky
      </p>
      <h1 className="mt-3 text-balance font-display text-4xl font-bold tracking-tight sm:text-5xl">
        A paid creator network you can leave without losing your audience
      </h1>
      <p className="mx-auto mt-5 max-w-2xl text-balance text-lg text-muted">
        Your identity is a portable Bluesky account — built on the open AT Protocol, a DID, not a
        username and password we own. Publish public posts to the open network, and keep
        subscriber-only content private to the people paying for it.
      </p>
      <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
        <Button asChild size="lg">
          <Link href="/login">Get Started</Link>
        </Button>
        <Button asChild size="lg" variant="secondary">
          <Link href="/become-a-creator">Become a creator</Link>
        </Button>
      </div>
    </section>
  );
}
