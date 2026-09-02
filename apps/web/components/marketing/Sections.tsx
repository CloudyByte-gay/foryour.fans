import { ArrowRight, KeyRound, Layers, LogIn, Network, ShieldCheck, Sparkles } from "lucide-react";
import { EmptyState } from "@/components/ui";

function SectionShell({
  id,
  eyebrow,
  title,
  children,
}: {
  id: string;
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={`${id}-heading`} className="border-t border-border py-16">
      <div className="mx-auto max-w-5xl px-4">
        <p className="text-sm font-medium uppercase tracking-wide text-primary">{eyebrow}</p>
        <h2 id={`${id}-heading`} className="mt-2 font-display text-2xl font-bold tracking-tight sm:text-3xl">
          {title}
        </h2>
        <div className="mt-8">{children}</div>
      </div>
    </section>
  );
}

const steps = [
  {
    icon: LogIn,
    title: "Bring your AT Protocol identity",
    body: "Sign in with your existing handle. There's no new account to create — your DID is the account, and it stays yours.",
  },
  {
    icon: ArrowRight,
    title: "Follow and subscribe",
    body: "Follow creators for their public posts. Subscribe to a tier to unlock subscriber-only content.",
  },
  {
    icon: Layers,
    title: "Access tiered content",
    body: "Paid posts stay private to entitled subscribers. Public posts go out on the open network for anyone.",
  },
];

export function HowItWorks() {
  return (
    <SectionShell id="how-it-works" eyebrow="How it works" title="Three steps, no new password">
      <ol className="grid gap-6 sm:grid-cols-3">
        {steps.map(({ icon: Icon, title, body }, i) => (
          <li key={title} className="space-y-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/15 text-primary">
              <Icon className="h-4 w-4" aria-hidden />
            </span>
            <p className="font-medium">
              <span className="text-muted">{i + 1}. </span>
              {title}
            </p>
            <p className="text-sm text-muted">{body}</p>
          </li>
        ))}
      </ol>
    </SectionShell>
  );
}

const creatorPoints = [
  {
    icon: Layers,
    title: "Set your own tiers",
    body: "Name, price and description per tier. Change prices any time — existing subscribers keep the price they signed up at.",
  },
  {
    icon: Network,
    title: "Keep your audience if you leave",
    body: "Followers and your public posts live on the AT Protocol network, not locked inside this app. Portability is the point.",
  },
  {
    icon: ShieldCheck,
    title: "Adult content is welcome",
    body: "NSFW creators are supported, behind an age gate and blurred by default. Identity verification is required before payouts.",
  },
];

export function ForCreators() {
  return (
    <SectionShell id="for-creators" eyebrow="For creators" title="Your audience, your terms">
      <div className="grid gap-6 sm:grid-cols-3">
        {creatorPoints.map(({ icon: Icon, title, body }) => (
          <div key={title} className="space-y-2">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-locked/20 text-locked">
              <Icon className="h-4 w-4" aria-hidden />
            </span>
            <p className="font-medium">{title}</p>
            <p className="text-sm text-muted">{body}</p>
          </div>
        ))}
      </div>
    </SectionShell>
  );
}

export function BuiltOnAtproto() {
  return (
    <SectionShell id="atproto" eyebrow="Built on AT Protocol" title="Identity you actually own">
      <div className="grid gap-6 sm:grid-cols-2">
        <div className="space-y-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/15 text-primary">
            <KeyRound className="h-4 w-4" aria-hidden />
          </span>
          <p className="font-medium">Your DID is portable</p>
          <p className="text-sm text-muted">
            foryour.fans never operates a PDS on your behalf. Public records are written to your own
            repository through OAuth-scoped writes — never to an app-controlled account.
          </p>
        </div>
        <div className="space-y-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/15 text-primary">
            <Network className="h-4 w-4" aria-hidden />
          </span>
          <p className="font-medium">Public posts are on the open network</p>
          <p className="text-sm text-muted">
            Anything public can be read and replicated by other AT Protocol apps. Subscriber-only
            content is different — it stays in foryour.fans and never becomes a public record.
          </p>
        </div>
      </div>
    </SectionShell>
  );
}

/**
 * Real discovery data arrives in WEB PHASE 10. Until then this renders an
 * `EmptyState` — per the spec, do not fake creators.
 */
export function FeaturedCreators() {
  return (
    <SectionShell id="featured" eyebrow="Featured creators" title="Discover creators">
      <EmptyState
        icon={Sparkles}
        title="Creator discovery is coming soon"
        description="Once creators start publishing, featured and trending creators show up here."
      />
    </SectionShell>
  );
}
