"use client";

import { useState } from "react";
import { Button, toast } from "@/components/ui";
import { logout } from "@/lib/auth";

export function LogoutButton() {
  const [loading, setLoading] = useState(false);

  async function handleLogout() {
    setLoading(true);
    const ok = await logout();
    if (!ok) {
      setLoading(false);
      toast({ title: "Couldn't log out", description: "Please try again.", variant: "error" });
    }
    // On success, logout() has already navigated away.
  }

  return (
    <Button variant="ghost" onClick={() => void handleLogout()} loading={loading}>
      Log out
    </Button>
  );
}
