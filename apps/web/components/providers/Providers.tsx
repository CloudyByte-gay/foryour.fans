"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { Toaster } from "@/components/ui";
import { TooltipProvider } from "@/components/ui/Tooltip";
import type { SessionState } from "@/lib/session";
import type { ThemePreference } from "@/lib/theme";
import { SessionProvider } from "./SessionProvider";
import { ThemeProvider } from "./ThemeProvider";

/**
 * Single client-side provider tree mounted once in the root layout. No global
 * store beyond TanStack Query + the session/theme contexts (per the tech
 * choices in prompts/web.md).
 */
export function Providers({
  session,
  themePreference,
  children,
}: {
  session: SessionState;
  themePreference: ThemePreference;
  children: React.ReactNode;
}) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider initial={session}>
        <ThemeProvider initialPreference={themePreference}>
          <TooltipProvider delayDuration={200}>
            {children}
            <Toaster />
          </TooltipProvider>
        </ThemeProvider>
      </SessionProvider>
    </QueryClientProvider>
  );
}
