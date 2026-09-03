import Link from "next/link";
import { Avatar, Badge, Card, CardContent } from "@/components/ui";
import { creatorHref, fromPriceLabel, type DiscoveryCreator } from "@/lib/discover";

/**
 * One creator card on `/discover`, `/search`, and the home page's featured
 * strip. `isRegisteredCreator` decides whether it links to `/c/:handle` —
 * the index covers any DID on the network publishing `fans.foryour.profile`,
 * not only ones that have signed in here (see
 * apps/api/src/routes/discovery.ts's doc comment), so an unregistered result
 * stays inert rather than sending the visitor to a 404.
 */
export function CreatorCard({ creator }: { creator: DiscoveryCreator }) {
  const name = creator.displayName || creator.handle || creator.did;
  const priceLabel = fromPriceLabel(creator);

  const body = (
    <CardContent className="flex h-full flex-col gap-3 py-5">
      <div className="flex items-center gap-3">
        <Avatar src={creator.avatarUrl} name={name} size="lg" />
        <div className="min-w-0">
          <p className="truncate font-display font-semibold">{name}</p>
          {creator.handle && <p className="truncate text-sm text-muted">@{creator.handle}</p>}
        </div>
      </div>
      {creator.bio && <p className="line-clamp-2 text-sm text-muted">{creator.bio}</p>}
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
        {creator.isRegisteredCreator ? (
          <>
            {creator.tierCount > 0 && (
              <Badge variant="primary">
                {creator.tierCount} {creator.tierCount === 1 ? "tier" : "tiers"}
              </Badge>
            )}
            {priceLabel && <span className="text-xs text-muted">{priceLabel}</span>}
          </>
        ) : (
          <Badge variant="neutral">Not on foryour.fans yet</Badge>
        )}
      </div>
    </CardContent>
  );

  if (!creator.isRegisteredCreator) {
    return (
      <Card className="h-full opacity-75" aria-disabled="true">
        {body}
      </Card>
    );
  }

  return (
    <Link
      href={creatorHref(creator)}
      aria-label={name}
      className="block rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <Card className="h-full transition-colors hover:border-primary/50">{body}</Card>
    </Link>
  );
}
