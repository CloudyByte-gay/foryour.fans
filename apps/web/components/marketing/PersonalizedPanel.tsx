import { LayoutDashboard, Rss, Sparkles, Wallet } from "lucide-react";
import Link from "next/link";
import { Card } from "@/components/ui";
import type { SessionUser } from "@/lib/session";

interface QuickLink {
  href: string;
  label: string;
  description: string;
  icon: typeof Rss;
}

/**
 * Replaces the hero on `/` for a logged-in visitor (requirement: do not
 * hard-redirect them away from `/`). Renders on the server from the session
 * already resolved by the layout — no client fetch.
 */
export function PersonalizedPanel({ user, isCreator }: { user: SessionUser; isCreator: boolean }) {
  const name = user.displayName ?? user.handle ?? "there";

  const links: QuickLink[] = [
    { href: "/feed", label: "Your feed", description: "Posts from creators you follow", icon: Rss },
    {
      href: "/subscriptions",
      label: "Subscriptions",
      description: "Manage what you support",
      icon: Wallet,
    },
    isCreator
      ? {
          href: "/creator/dashboard",
          label: "Creator dashboard",
          description: "Subscribers, revenue, posts",
          icon: LayoutDashboard,
        }
      : {
          href: "/become-a-creator",
          label: "Become a creator",
          description: "Set up tiers and start publishing",
          icon: Sparkles,
        },
  ];

  return (
    <section className="mx-auto max-w-3xl px-4 py-14">
      <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">
        Welcome back, {name}
      </h1>
      <p className="mt-1 text-muted">Pick up where you left off.</p>
      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        {links.map(({ href, label, description, icon: Icon }) => (
          <Card key={href} className="transition-colors hover:border-primary/50">
            <Link href={href} className="block h-full rounded-lg p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <Icon className="h-5 w-5 text-primary" aria-hidden />
              <p className="mt-2 font-medium">{label}</p>
              <p className="mt-0.5 text-sm text-muted">{description}</p>
            </Link>
          </Card>
        ))}
      </div>
    </section>
  );
}
