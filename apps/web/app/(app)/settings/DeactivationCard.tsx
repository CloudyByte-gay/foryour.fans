import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui";

/**
 * Placeholder — no destructive action is wired. Deactivation is described
 * honestly: foryour.fans can't delete records in the user's own AT Protocol
 * repository, only stop indexing them and issue authorized deletes.
 */
export function DeactivationCard() {
  return (
    <Card className="border-danger/30">
      <CardHeader>
        <CardTitle>Deactivate account</CardTitle>
        <CardDescription>Not available yet — here&rsquo;s what it will do.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm text-muted">
        <p>
          Deactivating stops foryour.fans from indexing your activity and hides your creator page
          and posts. Any active subscriptions are cancelled at the end of the current period.
        </p>
        <p>
          foryour.fans <strong className="font-medium text-foreground">cannot delete records in
          your own Bluesky repository (an AT Protocol account)</strong> — your identity and any
          public posts live on your PDS, not our servers. It can only issue authorized delete
          requests for the records it published on your behalf and stop replicating the rest.
        </p>
        <p>Your DID always remains yours and can be used with Bluesky or any other AT Protocol app.</p>
      </CardContent>
    </Card>
  );
}
