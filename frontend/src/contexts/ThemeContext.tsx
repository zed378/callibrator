"use client";

/**
 * The dashboard's view of the app's ONE theme mechanism (lib/theme.ts,
 * ADR-118 Am. 3, ADR-122 §5).
 *
 * - It writes through the same `applyTheme` as the public pages' toggle, so a
 *   choice made in the dashboard marks `data-theme-choice` too and a
 *   client-side navigation to `/` shows it (spec P11-00 D9).
 * - With no choice stored it follows the device's `prefers-color-scheme`, as
 *   the public pages do (P11-Q4 A; it used to stay light, D10). The init
 *   script already painted that state; this only reads it.
 * - It re-reads on every change: its own writes, a public island's, another
 *   tab's (`storage`) and the device's. `useSyncExternalStore` renders the
 *   server snapshot (light) during hydration, then the real state, with no
 *   hydration mismatch.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore } from "react";
import {
  applyTheme,
  clearThemeChoice,
  effectiveDark,
  markedChoice,
  subscribeTheme,
  syncThemeFromStorage,
  systemDark,
  type ThemeChoice,
} from "@/lib/theme";

type Theme = ThemeChoice;

interface ThemeContextValue {
  /** What is shown. */
  theme: Theme;
  /** The device's setting. */
  systemTheme: Theme;
  /** The user's choice, or null while following the device. */
  choice: Theme | null;
  toggleTheme: () => void;
  /** Forget the choice and follow the device ("Use device setting"). */
  followDevice: () => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

const themeSnapshot = (): Theme => (effectiveDark() ? "dark" : "light");
const systemSnapshot = (): Theme => (systemDark() ? "dark" : "light");
const choiceSnapshot = (): Theme | null => markedChoice();
const serverTheme = (): Theme => "light";
const serverChoice = (): Theme | null => null;

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useSyncExternalStore(subscribeTheme, themeSnapshot, serverTheme);
  const systemTheme = useSyncExternalStore(subscribeTheme, systemSnapshot, serverTheme);
  const choice = useSyncExternalStore(subscribeTheme, choiceSnapshot, serverChoice);

  // The init script set <html> before paint; re-reading storage once is a
  // no-op then, and the start state where it did not run.
  useEffect(() => {
    syncThemeFromStorage();
  }, []);

  const toggleTheme = useCallback(() => applyTheme(!effectiveDark()), []);
  const followDevice = useCallback(() => clearThemeChoice(), []);

  const value = useMemo(
    () => ({ theme, systemTheme, choice, toggleTheme, followDevice }),
    [theme, systemTheme, choice, toggleTheme, followDevice],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
