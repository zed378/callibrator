/**
 * P10-02 (ADR-098 §4, doc 20 §5): the public surfaces' two languages.
 * Indonesian is the default for everyone; there is no Accept-Language sniffing.
 */
export const LOCALES = ["id", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "id";

/** The cookie the `setLocale` Server Action writes and the server reads. */
export const LOCALE_COOKIE = "locale";
/** One year. */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export const isLocale = (value: unknown): value is Locale =>
  typeof value === "string" && (LOCALES as readonly string[]).includes(value);

/** Absent or unknown → the default. */
export const resolveLocale = (value: string | undefined | null): Locale =>
  isLocale(value) ? value : DEFAULT_LOCALE;

/**
 * `<html lang>` for a request: the dashboard is English until Phase 11 decides
 * its language (ADR-098 §4); every other page follows the public locale.
 */
export const htmlLangFor = (pathname: string, locale: Locale): Locale =>
  pathname === "/dashboard" || pathname.startsWith("/dashboard/") ? "en" : locale;
