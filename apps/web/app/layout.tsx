import type { Metadata } from "next";
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

  return (
    <html
      lang="en"
      className={`${fontSans.variable} ${fontDisplay.variable} ${themeClassFor(themePreference)}`}
      suppressHydrationWarning
    >
      <head>
        <ThemeScript />
      </head>
      <body className="min-h-dvh bg-background text-foreground antialiased">
        <Providers session={session} themePreference={themePreference}>
          {children}
        </Providers>
      </body>
    </html>
  );
}
