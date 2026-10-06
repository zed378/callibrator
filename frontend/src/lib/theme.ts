/**
 * The app's ONE light/dark mechanism (ADR-118 Am. 3 §1, ADR-122 §5).
 *
 * State lives in three places that always agree:
 *   - `localStorage["hdc-theme-preference"]` — the user's choice, `light` | `dark`, or absent;
 *   - `data-theme-choice` on <html> — the same choice, for CSS (public-surface.css
 *     follows `prefers-color-scheme` only while it is absent);
 *   - `.dark` on <html> — what is shown: the choice, or the device's setting.
 *
 * The root layout's nonce'd init script (`lib/themeInitScript.ts`) sets them
 * before first paint. After that, every write goes through `applyTheme` or
 * `clearThemeChoice` here — the dashboard's `ThemeContext` and the public
 * pages' `PublicThemeToggle` alike — so a choice made on one surface is the
 * other's too, without a reload (spec P11-00 D9).
 *
 * No React here, and nothing that runs at import: the public pages bundle it.
 */

export const THEME_STORAGE_KEY = "hdc-theme-preference";
/** Fired on `window` after every change made here. */
export const THEME_EVENT = "pub-theme-change";

export type ThemeChoice = "light" | "dark";

const media = (): MediaQueryList | null =>
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-color-scheme: dark)")
    : null;

/** Whether the device prefers dark. */
export const systemDark = (): boolean => media()?.matches === true;

/** The stored choice, or null when the user has not chosen (or storage is blocked). */
export const storedChoice = (): ThemeChoice | null => {
  try {
    const v = window.localStorage.getItem(THEME_STORAGE_KEY);
    return v === "light" || v === "dark" ? v : null;
  } catch {
    return null;
  }
};

/** The theme the page is showing right now: the marked choice, else the device. */
export const effectiveDark = (): boolean => {
  const choice = document.documentElement.getAttribute("data-theme-choice");
  if (choice === "dark") return true;
  if (choice === "light") return false;
  return systemDark();
};

/** The choice marked on the page (`data-theme-choice`), or null while following the device. */
export const markedChoice = (): ThemeChoice | null => {
  const choice = document.documentElement.getAttribute("data-theme-choice");
  return choice === "light" || choice === "dark" ? choice : null;
};

const notify = () => window.dispatchEvent(new Event(THEME_EVENT));

/** Put <html> in the state a choice (or none) means, without touching storage. */
const mark = (choice: ThemeChoice | null) => {
  const root = document.documentElement;
  if (choice) root.setAttribute("data-theme-choice", choice);
  else root.removeAttribute("data-theme-choice");
  root.classList.toggle("dark", choice ? choice === "dark" : systemDark());
};

/** Apply and remember a choice, exactly as the init script would on the next load. */
export const applyTheme = (dark: boolean) => {
  const choice: ThemeChoice = dark ? "dark" : "light";
  mark(choice);
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    // Storage blocked (private mode): the choice holds for this page only.
  }
  notify();
};

/** Forget the choice: both surfaces follow the device's setting again ("Use device setting"). */
export const clearThemeChoice = () => {
  try {
    window.localStorage.removeItem(THEME_STORAGE_KEY);
  } catch {
    // Storage blocked: nothing was stored.
  }
  mark(null);
  notify();
};

/**
 * Re-read the stored choice into <html> (what the init script did at load).
 * Used on mount by ThemeContext — a no-op after the init script, and the
 * start state where no script ran (tests) — and on another tab's change.
 */
export const syncThemeFromStorage = () => {
  mark(storedChoice());
  notify();
};

/**
 * Subscribe to every change: a write here, another tab's write (`storage`),
 * and a device change. The init script keeps `.dark` in step with the device
 * while nothing is chosen; this only tells the listener to re-read.
 */
export const subscribeTheme = (onChange: () => void): (() => void) => {
  const onStorage = (e: StorageEvent) => {
    if (e.key === THEME_STORAGE_KEY || e.key === null) syncThemeFromStorage();
  };
  const mq = media();
  const onDevice = () => {
    if (!markedChoice()) document.documentElement.classList.toggle("dark", systemDark());
    onChange();
  };
  window.addEventListener(THEME_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  mq?.addEventListener?.("change", onDevice);
  return () => {
    window.removeEventListener(THEME_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
    mq?.removeEventListener?.("change", onDevice);
  };
};
