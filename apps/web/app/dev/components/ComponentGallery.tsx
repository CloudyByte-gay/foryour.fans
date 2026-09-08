"use client";

import { Sparkles } from "lucide-react";
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
  Checkbox,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  ErrorState,
  FormDescription,
  FormField,
  FormLabel,
  Input,
  Label,
  Select,
  Skeleton,
  Spinner,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  toast,
} from "@/components/ui";

function Row({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2 border-t border-border pt-4 first:border-0 first:pt-0">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</h3>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}

export function ComponentGallery() {
  const [checked, setChecked] = useState(true);
  const [switched, setSwitched] = useState(false);

  return (
    <div className="space-y-5 text-foreground">
      <Row title="Button">
        <Button>Primary</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="destructive">Destructive</Button>
        <Button loading>Loading</Button>
        <Button disabled>Disabled</Button>
        <Button size="sm">Small</Button>
        <Button size="lg">Large</Button>
      </Row>

      <Row title="Badge">
        <Badge>Neutral</Badge>
        <Badge variant="primary">Primary</Badge>
        <Badge variant="success">Active</Badge>
        <Badge variant="warning">Past due</Badge>
        <Badge variant="danger">Removed</Badge>
        <Badge variant="locked">
          <Sparkles className="h-3 w-3" aria-hidden /> Premium
        </Badge>
      </Row>

      <Row title="Inputs">
        <div className="w-56 space-y-1">
          <Label htmlFor="g-in">Handle</Label>
          <Input id="g-in" placeholder="alice.bsky.social" />
        </div>
        <div className="w-56 space-y-1">
          <Label htmlFor="g-in-err">Invalid</Label>
          <Input id="g-in-err" defaultValue="nope" invalid />
        </div>
        <div className="w-56 space-y-1">
          <Label htmlFor="g-sel">Currency</Label>
          <Select id="g-sel" defaultValue="usd">
            <option value="usd">USD</option>
            <option value="eur">EUR</option>
          </Select>
        </div>
        <div className="w-64 space-y-1">
          <Label htmlFor="g-ta">Bio</Label>
          <Textarea id="g-ta" placeholder="Tell people about yourself" />
        </div>
      </Row>

      <Row title="FormField">
        <FormField error="Enter a full URL, e.g. https://example.com" className="w-72">
          <FormLabel>Website</FormLabel>
          <Input defaultValue="example dot com" aria-invalid />
          <FormDescription>Shown on your public page.</FormDescription>
        </FormField>
      </Row>

      <Row title="Switch / Checkbox">
        <label htmlFor="g-switch" className="flex items-center gap-2 text-sm">
          <Switch id="g-switch" checked={switched} onCheckedChange={setSwitched} /> Adult content
        </label>
        <label htmlFor="g-checkbox" className="flex items-center gap-2 text-sm">
          <Checkbox id="g-checkbox" checked={checked} onCheckedChange={(v) => setChecked(v === true)} /> I agree
        </label>
      </Row>

      <Row title="Avatar">
        <Avatar name="Ada Lovelace" size="sm" />
        <Avatar name="Grace Hopper" size="md" />
        <Avatar name="Katherine Johnson" size="lg" />
        <Avatar src="https://invalid.example/none.png" name="Broken Image" size="lg" />
      </Row>

      <Row title="Card">
        <Card className="w-72">
          <CardHeader>
            <CardTitle>Supporter</CardTitle>
            <CardDescription>$5 / month</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted">Early access to all public posts.</CardContent>
        </Card>
      </Row>

      <Row title="Tabs">
        <Tabs defaultValue="account" className="w-full">
          <TabsList>
            <TabsTrigger value="account">Account</TabsTrigger>
            <TabsTrigger value="appearance">Appearance</TabsTrigger>
          </TabsList>
          <TabsContent value="account" className="text-sm text-muted">
            Account settings go here.
          </TabsContent>
          <TabsContent value="appearance" className="text-sm text-muted">
            Theme override goes here.
          </TabsContent>
        </Tabs>
      </Row>

      <Row title="Overlays">
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="secondary">Open dialog</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete tier?</DialogTitle>
              <DialogDescription>
                Existing subscribers keep access. The tier is deactivated, not destroyed.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="ghost">Cancel</Button>
              </DialogClose>
              <Button variant="destructive">Deactivate</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="secondary">Menu</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuLabel>Signed in</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem>Dashboard</DropdownMenuItem>
            <DropdownMenuItem>Settings</DropdownMenuItem>
            <DropdownMenuItem>Log out</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost">Hover me</Button>
          </TooltipTrigger>
          <TooltipContent>DID is immutable</TooltipContent>
        </Tooltip>

        <Button variant="secondary" onClick={() => toast({ title: "Saved", description: "Your changes are live.", variant: "success" })}>
          Fire toast
        </Button>
      </Row>

      <Row title="Feedback states">
        <Spinner label="Loading" />
        <div className="w-40 space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </Row>

      <EmptyState
        title="No tiers yet"
        description="Create a subscription tier so people can support you."
        action={<Button size="sm">New tier</Button>}
      />

      <ErrorState onRetry={() => toast({ title: "Retrying…" })} />
    </div>
  );
}
