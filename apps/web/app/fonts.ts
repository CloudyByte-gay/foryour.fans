import { Inter, Sora } from "next/font/google";

/*
 * next/font self-hosts these at build time (files are emitted into the app
 * bundle, not fetched from Google at runtime) and reserves metrics via a
 * `size-adjust` fallback, so there is no layout shift — the "loaded locally"
 * requirement in prompts/web.md WEB PHASE 0.
 */
export const fontSans = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
});

export const fontDisplay = Sora({
  subsets: ["latin"],
  display: "swap",
  weight: ["500", "600", "700"],
  variable: "--font-display",
});
