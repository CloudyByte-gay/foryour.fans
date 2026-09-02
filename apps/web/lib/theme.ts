export const THEME_COOKIE_NAME = "ff_theme";

/** User's explicit override. `system` (or absent) means follow the OS. */
export type ThemePreference = "system" | "light" | "dark";

/** What actually gets rendered — `system` is resolved client-side. */
export type ResolvedTheme = "light" | "dark";

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

/**
 * The class to put on <html> for the first paint. For `system` we render no
 * class and let the inline bootstrap script (ThemeScript) add `.dark` before
 * paint if the OS is dark — this is the anti-flash path.
 */
export function themeClassFor(preference: ThemePreference): "" | "dark" {
  return preference === "dark" ? "dark" : "";
}
