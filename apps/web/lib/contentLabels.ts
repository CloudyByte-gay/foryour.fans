/**
 * Shared display metadata for `ContentLabel` values — mirrors
 * `packages/moderation/src/labels.ts#KNOWN_LABEL_VALUES`. WEB PHASE 14.
 *
 * These are moderator/classifier-applied labels (`GET /posts/:id`'s
 * `labels` field), distinct from a creator's own AT-record self-labels
 * (an older, separate mechanism this phase doesn't touch — see
 * ContentLabel's doc comment in packages/database/prisma/schema.prisma).
 *
 * `dismissible: false` labels ("takedown") render as a hard, non-collapsible
 * notice with no "show anyway" control — the spec's "some labels are not
 * user-dismissible." Everything else blurs/collapses with a reveal.
 */
export interface LabelMeta {
  displayName: string;
  description: string;
  dismissible: boolean;
}

export const LABEL_META: Record<string, LabelMeta> = {
  porn: { displayName: "Pornography", description: "Contains explicit sexual content.", dismissible: true },
  sexual: { displayName: "Sexual content", description: "Contains sexual themes or imagery.", dismissible: true },
  nudity: { displayName: "Nudity", description: "Contains nudity.", dismissible: true },
  "graphic-media": { displayName: "Graphic media", description: "Contains graphic or disturbing imagery.", dismissible: true },
  spam: { displayName: "Spam", description: "Flagged as spam by a moderator.", dismissible: true },
  "ncii-review": {
    displayName: "Under review",
    description: "This content is under review for a non-consensual imagery report.",
    dismissible: true,
  },
  takedown: {
    displayName: "Removed",
    description: "This content has been removed by a moderator and is no longer available.",
    dismissible: false,
  },
};

const DEFAULT_META: LabelMeta = {
  displayName: "Labeled",
  description: "This content has been labeled by a moderator.",
  dismissible: true,
};

export function labelMeta(val: string): LabelMeta {
  return LABEL_META[val] ?? DEFAULT_META;
}

/** True when any of a post's labels is non-dismissible — the whole post's content, not just media, should stay hidden. */
export function hasNonDismissibleLabel(labels: string[]): boolean {
  return labels.some((val) => !labelMeta(val).dismissible);
}
