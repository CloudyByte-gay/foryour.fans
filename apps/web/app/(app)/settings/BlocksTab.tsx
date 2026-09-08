"use client";

import { ShieldOff, UserX } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, EmptyState, ErrorState, Skeleton, toast } from "@/components/ui";
import { listBlocks, unblockUser, type BlockedUserSummary } from "@/lib/blocks";

/**
 * `/settings` → Blocks (WEB PHASE 14) — the management list `prompts/web.md`
 * asks for. A query-param tab rather than a separate `/settings/blocks`
 * route, matching how Account/Appearance/Notifications already work here
 * (see SettingsTabs.tsx) rather than introducing a second navigation shape
 * for one more tab.
 */
export function BlocksTab() {
  const [state, setState] = useState<"loading" | "error" | "ready">("loading");
  const [blocks, setBlocks] = useState<BlockedUserSummary[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    setState("loading");
    try {
      setBlocks(await listBlocks());
      setState("ready");
    } catch {
      setState("error");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleUnblock(block: BlockedUserSummary) {
    const identifier = block.user?.did ?? block.blockedUserId;
    setBusyId(block.blockedUserId);
    const outcome = await unblockUser(identifier);
    setBusyId(null);
    if (!outcome.ok) {
      toast({ title: "Couldn't unblock", description: outcome.message, variant: "error" });
      return;
    }
    setBlocks((prev) => prev.filter((b) => b.blockedUserId !== block.blockedUserId));
    toast({ title: "Unblocked" });
  }

  if (state === "loading") {
    return (
      <div className="space-y-2">
        <Skeleton className="h-14 w-full rounded-lg" />
        <Skeleton className="h-14 w-full rounded-lg" />
      </div>
    );
  }

  if (state === "error") {
    return <ErrorState message="Couldn't load your blocked accounts." onRetry={() => void load()} />;
  }

  if (blocks.length === 0) {
    return (
      <EmptyState
        icon={ShieldOff}
        title="No blocked accounts"
        description="Accounts you block won't be able to comment on, like, or subscribe to your content, and you won't see their comments."
      />
    );
  }

  return (
    <ul className="space-y-2">
      {blocks.map((block) => {
        const name = block.user?.displayName ?? (block.user ? `@${block.user.handle ?? block.user.did}` : block.blockedUserId);
        return (
          <li key={block.blockedUserId} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
            <div className="flex items-center gap-2 text-sm">
              <UserX className="h-4 w-4 text-muted" aria-hidden />
              <span className="font-medium">{name}</span>
            </div>
            <Button
              variant="secondary"
              size="sm"
              loading={busyId === block.blockedUserId}
              onClick={() => handleUnblock(block)}
            >
              Unblock
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
