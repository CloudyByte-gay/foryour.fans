"use client";

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { restrictToParentElement, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Lock, Pencil, Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import {
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Switch,
  toast,
} from "@/components/ui";
import { apiFetch } from "@/lib/apiFetch";
import { csrfHeaders } from "@/lib/csrf";
import { formatPrice } from "@/lib/tier";
import type { OwnTier } from "./page";
import { TierFormDialog } from "./TierFormDialog";

/**
 * Pure reorder: move `activeId` to where `overId` sits. Exported for a unit
 * test — jsdom can't drive a real pointer drag through dnd-kit.
 */
export function reorder(list: OwnTier[], activeId: string, overId: string): OwnTier[] {
  const from = list.findIndex((t) => t.id === activeId);
  const to = list.findIndex((t) => t.id === overId);
  if (from === -1 || to === -1 || from === to) return list;
  return arrayMove(list, from, to).map((tier, i) => ({ ...tier, sortOrder: i }));
}

interface ApiError {
  error?: { message?: string; statusCode?: number };
}

async function readError(res: Response, fallback: string): Promise<string> {
  if (res.status === 502) {
    return "Saved, but publishing to Bluesky failed. Try again.";
  }
  const body = (await res.json().catch(() => null)) as ApiError | null;
  return body?.error?.message ?? fallback;
}

export function TierManager({
  pageAddress,
  initialTiers,
  isVerified,
}: {
  pageAddress: string;
  initialTiers: OwnTier[];
  /** WEB PHASE 14 — whether the creator's `verificationStatus` is VERIFIED; gates the "contains adult content" checkbox in TierFormDialog. */
  isVerified: boolean;
}) {
  const [tiers, setTiers] = useState<OwnTier[]>(initialTiers);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<OwnTier | null>(null);
  // Bumped on every open so <TierFormDialog> remounts with fresh field state
  // — its inputs seed from props via useState, which would otherwise keep the
  // previous entry across a close/reopen.
  const [formSeq, setFormSeq] = useState(0);
  const [deactivating, setDeactivating] = useState<OwnTier | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  function openForm(tier: OwnTier | null) {
    setEditing(tier);
    setFormSeq((n) => n + 1);
    setFormOpen(true);
  }

  const active = tiers.filter((t) => t.isActive).sort((a, b) => a.sortOrder - b.sortOrder);
  const inactive = tiers.filter((t) => !t.isActive);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function upsert(next: OwnTier) {
    setTiers((prev) => {
      const has = prev.some((t) => t.id === next.id);
      return has ? prev.map((t) => (t.id === next.id ? next : t)) : [...prev, next];
    });
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active: dragged, over } = event;
    if (!over || dragged.id === over.id) return;

    const snapshot = tiers;
    const reordered = reorder(active, String(dragged.id), String(over.id));
    const changed = reordered.filter((t) => {
      const before = active.find((a) => a.id === t.id);
      return before && before.sortOrder !== t.sortOrder;
    });
    if (changed.length === 0) return;

    // Optimistic: merge the new order back into the full list.
    setTiers((prev) => prev.map((t) => reordered.find((r) => r.id === t.id) ?? t));

    try {
      const results = await Promise.all(
        changed.map((t) =>
          apiFetch(`/creators/me/tiers/${t.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json", ...csrfHeaders() },
            body: JSON.stringify({ sortOrder: t.sortOrder }),
          }),
        ),
      );
      if (results.some((r) => !r.ok)) throw new Error("reorder failed");
    } catch {
      setTiers(snapshot);
      toast({
        title: "Couldn't save the new order",
        description: "Your tiers were put back the way they were.",
        variant: "error",
      });
    }
  }

  async function onToggle(tier: OwnTier, nextActive: boolean) {
    if (!nextActive) {
      setDeactivating(tier);
      return;
    }
    setBusyId(tier.id);
    try {
      const res = await apiFetch(`/creators/me/tiers/${tier.id}/reactivate`, {
        method: "POST",
        headers: { ...csrfHeaders() },
      });
      if (!res.ok) {
        toast({
          title: "Couldn't reactivate the tier",
          description: await readError(res, "Please try again."),
          variant: "error",
        });
        return;
      }
      upsert((await res.json()) as OwnTier);
      toast({ title: "Tier reactivated", description: "It's public again and re-published to the AT network." });
    } finally {
      setBusyId(null);
    }
  }

  async function confirmDeactivate() {
    if (!deactivating) return;
    const tier = deactivating;
    setBusyId(tier.id);
    try {
      const res = await apiFetch(`/creators/me/tiers/${tier.id}`, {
        method: "DELETE",
        headers: { ...csrfHeaders() },
      });
      if (!res.ok) {
        toast({
          title: "Couldn't deactivate the tier",
          description: await readError(res, "Please try again."),
          variant: "error",
        });
        return;
      }
      upsert((await res.json()) as OwnTier);
      setDeactivating(null);
      toast({ title: "Tier deactivated", description: "Existing subscribers keep their access." });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted">
          {active.length === 0
            ? "No active tiers."
            : `${active.length} active tier${active.length === 1 ? "" : "s"}. Drag to reorder.`}
        </p>
        <Button size="sm" onClick={() => openForm(null)}>
          <Plus className="h-4 w-4" aria-hidden />
          New tier
        </Button>
      </div>

      {tiers.length === 0 ? (
        <EmptyState
          title="No tiers yet"
          description="Create your first membership tier — a name, a monthly price, and what subscribers get."
          action={
            <Button size="sm" onClick={() => openForm(null)}>
              <Plus className="h-4 w-4" aria-hidden />
              New tier
            </Button>
          }
        />
      ) : (
        <>
          {active.length > 0 && (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              modifiers={[restrictToVerticalAxis, restrictToParentElement]}
              onDragEnd={handleDragEnd}
            >
              <SortableContext items={active.map((t) => t.id)} strategy={verticalListSortingStrategy}>
                <ul className="space-y-2">
                  {active.map((tier) => (
                    <SortableTierRow
                      key={tier.id}
                      tier={tier}
                      busy={busyId === tier.id}
                      onEdit={() => openForm(tier)}
                      onToggle={(next) => onToggle(tier, next)}
                    />
                  ))}
                </ul>
              </SortableContext>
            </DndContext>
          )}

          {inactive.length > 0 && (
            <section aria-labelledby="inactive-heading" className="space-y-2">
              <h2 id="inactive-heading" className="text-sm font-semibold text-muted">
                Deactivated
              </h2>
              <ul className="space-y-2">
                {inactive.map((tier) => (
                  <li key={tier.id}>
                    <Card>
                      <CardContent className="flex items-center gap-3 py-3">
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium text-muted">{tier.name}</p>
                          <p className="text-sm text-muted">
                            {formatPrice(tier.priceCents, tier.currency)} / month · not shown on your page
                          </p>
                        </div>
                        <label htmlFor={`tier-active-${tier.id}`} className="flex items-center gap-2 text-sm text-muted">
                          <span className="sr-only sm:not-sr-only">Active</span>
                          <Switch
                            id={`tier-active-${tier.id}`}
                            checked={false}
                            disabled={busyId === tier.id}
                            onCheckedChange={(next) => onToggle(tier, next)}
                            aria-label={`Reactivate ${tier.name}`}
                          />
                        </label>
                      </CardContent>
                    </Card>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      <p className="text-sm text-muted">
        Subscribers see these on{" "}
        <Link href={`/c/${pageAddress}`} className="text-primary hover:underline">
          your page
        </Link>
        . The <span className="inline-flex items-center gap-1"><Lock className="h-3 w-3" aria-hidden />Subscribe</span>{" "}
        button turns on when billing ships.
      </p>

      <TierFormDialog
        key={`${editing?.id ?? "new"}-${formSeq}`}
        open={formOpen}
        mode={editing ? "edit" : "create"}
        tier={editing}
        isVerified={isVerified}
        onOpenChange={setFormOpen}
        onSaved={(saved) => {
          upsert(saved);
          setFormOpen(false);
        }}
      />

      <Dialog open={deactivating !== null} onOpenChange={(open) => !open && setDeactivating(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Deactivate “{deactivating?.name}”?</DialogTitle>
            <DialogDescription>
              This tier is <strong>deactivated, not deleted</strong>. Existing subscribers keep their
              access and their historical billing — it just stops taking new subscriptions and
              disappears from your public page. You can reactivate it later.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeactivating(null)} disabled={busyId !== null}>
              Keep it active
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDeactivate}
              loading={busyId === deactivating?.id}
            >
              Deactivate tier
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SortableTierRow({
  tier,
  busy,
  onEdit,
  onToggle,
}: {
  tier: OwnTier;
  busy: boolean;
  onEdit: () => void;
  onToggle: (next: boolean) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tier.id,
  });

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={isDragging ? "relative z-10 opacity-80" : undefined}
    >
      <Card>
        <CardContent className="flex items-center gap-2 py-3 sm:gap-3">
          <button
            type="button"
            className="shrink-0 cursor-grab touch-none rounded p-1 text-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
            aria-label={`Reorder ${tier.name}`}
            {...attributes}
            {...listeners}
          >
            <GripVertical className="h-4 w-4" aria-hidden />
          </button>

          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{tier.name}</p>
            <p className="text-sm text-muted">
              {formatPrice(tier.priceCents, tier.currency)} / month
              {tier.description ? ` · ${tier.description}` : ""}
            </p>
          </div>

          <Button variant="ghost" size="sm" onClick={onEdit} className="shrink-0">
            <Pencil className="h-4 w-4" aria-hidden />
            <span className="sr-only sm:not-sr-only">Edit</span>
          </Button>

          <label htmlFor={`tier-active-${tier.id}`} className="flex shrink-0 items-center gap-2 text-sm text-muted">
            <span className="sr-only sm:not-sr-only">Active</span>
            <Switch
              id={`tier-active-${tier.id}`}
              checked
              disabled={busy}
              onCheckedChange={onToggle}
              aria-label={`Deactivate ${tier.name}`}
            />
          </label>
        </CardContent>
      </Card>
    </li>
  );
}
