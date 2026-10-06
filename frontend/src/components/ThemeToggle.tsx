"use client";

/**
 * The dashboard's light/dark switch (ADR-122 §5, spec P11-00 D11), the twin of
 * the public `PublicThemeToggle`:
 *   - a two-state switch: `aria-pressed` is "dark mode is on", and its name
 *     stays "Dark mode" (a toggle's name does not change with its state);
 *   - 40 × 40 px, the dense chrome's control height (the public one is 44);
 *   - the glyph is neutral ink — a status colour is never decoration;
 *   - it writes through the shared mechanism (lib/theme.ts via ThemeContext),
 *     so the choice carries to the public pages and back.
 * The dashboard is English until P11-08 decides its languages.
 */
import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/contexts/ThemeContext";

export default function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const dark = theme === "dark";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-pressed={dark}
      aria-label="Dark mode"
      title={dark ? "Dark mode is on" : "Dark mode is off"}
      className="inline-flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
    >
      {dark ? <Sun className="h-5 w-5" aria-hidden="true" /> : <Moon className="h-5 w-5" aria-hidden="true" />}
    </button>
  );
}
