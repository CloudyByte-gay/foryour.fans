"use client";

import { Flag, MoreHorizontal, ShieldOff } from "lucide-react";
import { useState } from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui";
import { BlockDialog } from "@/components/moderation/BlockDialog";
import { ReportDialog } from "@/components/moderation/ReportDialog";

/**
 * Report / block a creator, from `/c/:handle` (WEB PHASE 14). Only rendered
 * for an authenticated, non-owner viewer — see the call site in
 * `app/(marketing)/c/[handle]/page.tsx`.
 */
export function CreatorActionsMenu({ creatorId, creatorAddress, creatorName }: { creatorId: string; creatorAddress: string; creatorName: string }) {
  const [reportOpen, setReportOpen] = useState(false);
  const [blockOpen, setBlockOpen] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          className="rounded-full border border-border p-2 text-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`Actions for ${creatorName}`}
        >
          <MoreHorizontal className="h-4 w-4" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => setReportOpen(true)}>
            <Flag className="h-4 w-4" aria-hidden />
            Report {creatorName}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setBlockOpen(true)}>
            <ShieldOff className="h-4 w-4" aria-hidden />
            Block {creatorName}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ReportDialog open={reportOpen} onOpenChange={setReportOpen} subjectType="CREATOR" subjectId={creatorId} subjectLabel={creatorName} />
      <BlockDialog open={blockOpen} onOpenChange={setBlockOpen} identifier={creatorAddress} name={creatorName} />
    </>
  );
}
