"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Switch,
} from "@/components/ui";

const CHANNELS = [
  { id: "receipts", label: "Payment receipts", description: "When a subscription charge succeeds." },
  { id: "renewals", label: "Renewal reminders", description: "Before a subscription renews or lapses." },
  {
    id: "moderation",
    label: "Moderation notices",
    description: "If content you posted is actioned, or a report you filed is resolved.",
  },
  { id: "creator", label: "New posts from creators you subscribe to", description: "Digest of new subscriber-only posts." },
];

export function NotificationsTab() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Notifications</CardTitle>
        <CardDescription>
          Transactional email and notifications aren&rsquo;t built yet — this is a preview of the
          channels that are planned. Nothing here sends anything.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-1 divide-y divide-border">
        {CHANNELS.map((channel) => (
          <div key={channel.id} className="flex items-center justify-between gap-4 py-3 first:pt-0">
            <div>
              <p className="text-sm font-medium">{channel.label}</p>
              <p className="text-sm text-muted">{channel.description}</p>
            </div>
            <Switch disabled aria-label={`${channel.label} (not available yet)`} />
          </div>
        ))}
        <p className="pt-3 text-xs text-muted">
          Tracked as a deliberate gap in <code>docs/build-plan.md</code>; needed before a real-money
          launch.
        </p>
      </CardContent>
    </Card>
  );
}
