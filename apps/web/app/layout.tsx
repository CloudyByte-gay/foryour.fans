import type { Metadata } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";
import { ThemeScript } from "@/components/ThemeScript";
import { Providers } from "@/components/providers/Providers";
import { getSession } from "@/lib/session";
import { SITE_URL } from "@/lib/site";
import { getThemePreference } from "@/lib/theme.server";
import { themeClassFor } from "@/lib/theme";
import { fontDisplay, fontSans } from "./fonts";
import "./globals.css";

const DESCRIPTION = "An AT Protocol-native paid creator network.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "foryour.fans",
    template: "%s · foryour.fans",
  },
  description: DESCRIPTION,
  applicationName: "foryour.fans",
  openGraph: {
    siteName: "foryour.fans",
    type: "website",
    title: "foryour.fans",
    description: DESCRIPTION,
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
    title: "foryour.fans",
    description: DESCRIPTION,
  },
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Resolved once on the server; passed into the client providers and never
  // re-fetched on mount (requirement #2).
  const [session, themePreference] = await Promise.all([getSession(), getThemePreference()]);
  // `await` here is forward-compatible with Next 15's async `headers()`
  // (a no-op today, since Next 14's is synchronous) — same pattern
  // lib/theme.server.ts already uses for `cookies()`.
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html
      lang="en"
      className={`${fontSans.variable} ${fontDisplay.variable} ${themeClassFor(themePreference)}`}
      suppressHydrationWarning
    >
      <head>
        <ThemeScript nonce={nonce} />
      </head>
      <body className="min-h-dvh bg-background text-foreground antialiased">
        <Providers session={session} themePreference={themePreference}>
          {children}
        </Providers>
      </body>
    </html>
  );
}
