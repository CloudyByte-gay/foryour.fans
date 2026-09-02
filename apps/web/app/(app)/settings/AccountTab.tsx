"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  Avatar,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CopyButton,
  toast,
} from "@/components/ui";
import { apiFetch } from "@/lib/apiFetch";
import { cn } from "@/lib/cn";
import { csrfHeaders } from "@/lib/csrf";
import type { SessionUser } from "@/lib/session";
import { DeactivationCard } from "./DeactivationCard";

const CACHED = (
  <Badge variant="neutral" className="shrink-0">
    Cached from AT Protocol
  </Badge>
);

function Field({
  label,
  children,
  provenance = CACHED,
  className,
}: {
  label: string;
  children: React.ReactNode;
  provenance?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3", className)}>
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
        <div className="mt-0.5 break-words text-sm">{children}</div>
      </div>
      {provenance}
    </div>
  );
}

export function AccountTab({ me }: { me: SessionUser }) {
  const router = useRouter();
  const [profile, setProfile] = useState<SessionUser>(me);
  const [refreshing, setRefreshing] = useState(false);

  async function refresh() {
    setRefreshing(true);
    try {
      const res = await apiFetch("/me/refresh", { method: "POST", headers: csrfHeaders() });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        toast({
          title: "Couldn't refresh",
          description: body?.error?.message ?? "Try again in a moment.",
          variant: "error",
        });
        return;
      }
      const updated = (await res.json()) as SessionUser;
      setProfile(updated);
      toast({ title: "Profile refreshed from AT Protocol", variant: "success" });
      // Re-render server components (the header avatar, etc.).
      router.refresh();
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
          <CardDescription>
            foryour.fans caches these fields from your AT Protocol profile — your PDS is the source
            of truth, and they re-sync every time you sign in.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-1">
          <div className="flex items-center gap-4 pb-2">
            <Avatar src={profile.avatarUrl} name={profile.displayName ?? profile.handle} size="lg" />
            <div className="min-w-0">
              <p className="truncate font-medium">{profile.displayName ?? "No display name"}</p>
              <p className="truncate text-sm text-muted">
                {profile.handle ? `@${profile.handle}` : "No handle"}
              </p>
            </div>
          </div>

          <div className="divide-y divide-border border-t border-border">
            <Field label="Display name">{profile.displayName ?? <span className="text-muted">Not set</span>}</Field>
            <Field label="Handle">
              {profile.handle ? `@${profile.handle}` : <span className="text-muted">Not set</span>}
            </Field>
            <Field
              label="DID"
              provenance={
                <Badge variant="primary" className="shrink-0">
                  Your identity · immutable
                </Badge>
              }
            >
              <span className="flex items-center gap-2">
                <code className="rounded bg-surface-muted px-1.5 py-0.5 font-mono text-xs">
                  {profile.did}
                </code>
                <CopyButton value={profile.did} label="Copy DID" />
              </span>
            </Field>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" onClick={() => void refresh()} loading={refreshing}>
          <RefreshCw className="h-4 w-4" aria-hidden />
          Refresh from AT Protocol
        </Button>
        <p className="text-sm text-muted">
          Re-pulls your handle, display name, avatar and banner from your PDS. Your DID never changes.
        </p>
      </div>

      <p className="text-sm text-muted">
        Anything foryour.fans owns about your account — your subscriptions, and for creators your
        verification and payout status — is managed in its own section, not here.
      </p>

      <DeactivationCard />
    </div>
  );
}
