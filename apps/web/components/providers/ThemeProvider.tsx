"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { THEME_COOKIE_NAME, type ThemePreference } from "@/lib/theme";

interface ThemeContextValue {
  /** The user's stored choice. */
  preference: ThemePreference;
  /** What is actually on screen right now (`system` resolved). */
  resolved: "light" | "dark";
  setPreference: (next: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const ONE_YEAR = 60 * 60 * 24 * 365;

function systemPrefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function applyClass(resolved: "light" | "dark") {
  document.documentElement.classList.toggle("dark", resolved === "dark");
}

export function ThemeProvider({
  initialPreference,
  children,
}: {
  initialPreference: ThemePreference;
  children: React.ReactNode;
}) {
  const [preference, setPreferenceState] = useState<ThemePreference>(initialPreference);
  const [resolved, setResolved] = useState<"light" | "dark">(
    initialPreference === "dark" ? "dark" : initialPreference === "light" ? "light" : "light",
  );

  // Track the OS setting while the preference is `system`.
  useEffect(() => {
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => {
      const next = preference === "system" ? (mql.matches ? "dark" : "light") : preference;
      setResolved(next);
      applyClass(next);
    };
    sync();
    if (preference === "system") {
      mql.addEventListener("change", sync);
      return () => mql.removeEventListener("change", sync);
    }
  }, [preference]);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    document.cookie = `${THEME_COOKIE_NAME}=${next}; path=/; max-age=${ONE_YEAR}; samesite=lax`;
    const effective = next === "system" ? (systemPrefersDark() ? "dark" : "light") : next;
    setResolved(effective);
    applyClass(effective);
  }, []);

  return (
    <ThemeContext.Provider value={{ preference, resolved, setPreference }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within <ThemeProvider>");
  return ctx;
}
