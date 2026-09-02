import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui";

export const metadata: Metadata = {
  title: "About",
  description:
    "foryour.fans is a paid creator platform built on the AT Protocol, so identity and audience stay portable.",
  alternates: { canonical: "/about" },
};

export default function AboutPage() {
  return (
    <article className="mx-auto max-w-2xl px-4 py-16">
      <h1 className="font-display text-3xl font-bold tracking-tight">About foryour.fans</h1>

      <div className="mt-6 space-y-6 text-muted">
        <p>
          foryour.fans is a subscription platform for creators — public posts on the open network,
          plus paid tiers for subscriber-only content. What makes it different is the foundation:
          the <span className="text-foreground">AT Protocol</span>.
        </p>

        <h2 className="font-display text-xl font-semibold text-foreground">Why AT Protocol</h2>
        <p>
          On most creator platforms your account, your followers and your content live inside one
          company's database. Leaving means starting over. On the AT Protocol, your identity is a{" "}
          <span className="text-foreground">DID</span> — a portable account you control, hosted in a
          data repository (a PDS) that you can move between providers.
        </p>
        <p>
          foryour.fans never runs a PDS on your behalf. When you publish something public, it's
          written to <span className="text-foreground">your</span> repository through an
          OAuth-scoped write. If you stop using foryour.fans, those records and your followers go
          with you.
        </p>

        <h2 className="font-display text-xl font-semibold text-foreground">
          Public vs. subscriber-only
        </h2>
        <p>
          Public posts are AT Protocol records: other apps on the network can read and replicate
          them. Subscriber-only content is deliberately <span className="text-foreground">not</span>{" "}
          a public record — it stays within foryour.fans and is served only to entitled
          subscribers.
        </p>

        <h2 className="font-display text-xl font-semibold text-foreground">Adult content</h2>
        <p>
          Adult / NSFW creators are supported. Adult browsing sits behind an age-confirmation gate,
          NSFW media is blurred until you choose to reveal it, and creator identity verification is
          required before a creator can receive payouts.
        </p>
      </div>

      <div className="mt-10">
        <Button asChild>
          <Link href="/login">Continue with AT Protocol</Link>
        </Button>
      </div>
    </article>
  );
}
