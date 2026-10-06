"use client";
/**
 * P10-17 (ADR-118 Amendment 3): the public pages' light/dark switch. It uses
 * the app's ONE theme mechanism — the dashboard's `ThemeContext` key
 * (`localStorage` `hdc-theme-preference`) and the `.dark` class on <html>,
 * applied before first paint by the root layout's nonce'd init script — so a
 * choice made here carries into the dashboard and back. Without a choice the
 * public pages follow `prefers-color-scheme` (public-surface.css).
 *
 * The public pages do not mount ThemeProvider (ADR-098 Amendment 2 keeps
 * client providers out of the root layout), so this island reads and writes
 * the same state directly. `useSyncExternalStore` renders the server snapshot
 * (light) during hydration and the real state after, with no hydration
 * mismatch and no layout shift (the button's box never changes).
 */
import React, { useSyncExternalStore } from "react";
import { applyTheme, effectiveDark, subscribeTheme } from "@/lib/theme";

/**
 * The two glyphs, drawn here (lucide `moon` / `sun` paths, ISC) rather than
 * imported from icons/static: on the auth pages this island is the only client
 * code that would pull that 44-icon module into the bundle (QA M3, budget).
 */
const Glyph = ({ dark }: { dark: boolean }) => (
  <svg
    viewBox="0 0 24 24"
    width="20"
    height="20"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
    className="shrink-0"
  >
    {dark ? (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2m-7.07-17.07 1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
      </>
    ) : (
      <path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401" />
    )}
  </svg>
);

// ADR-122 (P11-02): the mechanism moved to lib/theme.ts, which the dashboard
// ThemeContext uses too — one write path for both surfaces. Re-exported here
// for the callers and tests that import it from this module.
export { THEME_STORAGE_KEY, applyTheme, effectiveDark } from "@/lib/theme";

export function PublicThemeToggle({ label }: { label: string }) {
  const dark = useSyncExternalStore(subscribeTheme, effectiveDark, () => false);
  return (
    <button
      type="button"
      onClick={() => applyTheme(!dark)}
      aria-pressed={dark}
      aria-label={label}
      title={label}
      className="pub-btn pub-btn-ghost pub-icon-btn"
    >
      <Glyph dark={dark} />
    </button>
  );
}

export default PublicThemeToggle;
