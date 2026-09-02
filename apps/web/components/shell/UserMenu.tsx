"use client";

import { LayoutDashboard, LogOut, Settings, Wallet } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import {
  Avatar,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  toast,
} from "@/components/ui";
import { logout } from "@/lib/auth";
import type { SessionUser } from "@/lib/session";

export function UserMenu({ user, isCreator }: { user: SessionUser; isCreator: boolean }) {
  const [loggingOut, setLoggingOut] = useState(false);
  const label = user.displayName ?? user.handle ?? "Account";

  async function handleLogout() {
    setLoggingOut(true);
    const ok = await logout();
    if (!ok) {
      setLoggingOut(false);
      toast({ title: "Couldn't log out", description: "Please try again.", variant: "error" });
    }
    // On success, logout() has already navigated to "/".
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        aria-label="Account menu"
      >
        <Avatar src={user.avatarUrl} name={label} size="sm" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel className="truncate">{label}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {isCreator && (
          <DropdownMenuItem asChild>
            <Link href="/creator/dashboard">
              <LayoutDashboard className="h-4 w-4" aria-hidden />
              Dashboard
            </Link>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem asChild>
          <Link href="/subscriptions">
            <Wallet className="h-4 w-4" aria-hidden />
            Subscriptions
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/settings">
            <Settings className="h-4 w-4" aria-hidden />
            Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={(event) => {
            event.preventDefault();
            void handleLogout();
          }}
          disabled={loggingOut}
        >
          <LogOut className="h-4 w-4" aria-hidden />
          {loggingOut ? "Logging out…" : "Log out"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
