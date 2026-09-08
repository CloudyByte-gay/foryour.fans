"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui";
import type { SessionUser } from "@/lib/session";
import { AccountTab } from "./AccountTab";
import { AppearanceTab } from "./AppearanceTab";
import { BlocksTab } from "./BlocksTab";
import { NotificationsTab } from "./NotificationsTab";

export function SettingsTabs({ me, initialTab }: { me: SessionUser; initialTab: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const value = params.get("tab") ?? initialTab;

  function onValueChange(next: string) {
    const q = new URLSearchParams(params);
    q.set("tab", next);
    router.replace(`${pathname}?${q.toString()}`, { scroll: false });
  }

  return (
    <Tabs value={value} onValueChange={onValueChange} className="w-full">
      <TabsList>
        <TabsTrigger value="account">Account</TabsTrigger>
        <TabsTrigger value="appearance">Appearance</TabsTrigger>
        <TabsTrigger value="notifications">Notifications</TabsTrigger>
        <TabsTrigger value="blocks">Blocks</TabsTrigger>
      </TabsList>

      <TabsContent value="account">
        <AccountTab me={me} />
      </TabsContent>
      <TabsContent value="appearance">
        <AppearanceTab />
      </TabsContent>
      <TabsContent value="notifications">
        <NotificationsTab />
      </TabsContent>
      <TabsContent value="blocks">
        <BlocksTab />
      </TabsContent>
    </Tabs>
  );
}
