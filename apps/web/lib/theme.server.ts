import "server-only";
import { cookies } from "next/headers";
import { THEME_COOKIE_NAME, type ThemePreference, isThemePreference } from "./theme";

/**
 * Read the theme override from the cookie during SSR. Returns `system` when
 * unset so the client falls back to `prefers-color-scheme`.
 */
export async function getThemePreference(): Promise<ThemePreference> {
  const value = (await cookies()).get(THEME_COOKIE_NAME)?.value;
  return isThemePreference(value) ? value : "system";
}
