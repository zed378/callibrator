/**
 * ADR-090 amendment (2026-09-29): a tenant's brand colour is never applied
 * unchecked. It is turned into one `--primary` per theme that meets the
 * ADR-090 contrast rule there, keeping the brand's hue and saturation and
 * moving only its lightness — darker for the light theme, lighter for the
 * dark one — and only as far as the rule needs. A colour that already passes
 * is used exactly as the tenant chose it.
 *
 * Why per theme: one colour cannot pass 4.5:1 as text against both the light
 * card (#ffffff) and the dark card (#1e293b) — it would need a relative
 * luminance of at most 0.183 for the first and at least 0.214 for the second.
 * So rejecting "bad" colours at save time could only ever reject every colour
 * for one theme or the other; deriving is the only rule that always yields a
 * readable result.
 *
 * The surfaces below mirror `app/globals.css`; `brandColor.test.ts` reads
 * that file and fails if they drift.
 */

export type Rgb = [number, number, number];

/** Parse `#RRGGBB` (the only form the backend accepts), or null. */
export const parseHex = (value: string | null | undefined): Rgb | null => {
  const m = /^#?([0-9a-fA-F]{6})$/.exec((value || "").trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

export const toHex = (c: Rgb): string =>
  `#${c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;

/** WCAG 2.x relative luminance. */
export const luminance = (c: Rgb): number => {
  const [r, g, b] = c.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** WCAG 2.x contrast ratio, 1 to 21. */
export const contrastRatio = (a: Rgb, b: Rgb): number => {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

/** A Tailwind `bg-x/NN` tint of `c` composited over `under`. */
export const tint = (c: Rgb, under: Rgb, alpha: number): Rgb =>
  c.map((v, i) => Math.round(v * alpha + under[i] * (1 - alpha))) as Rgb;

/** WCAG 1.4.3, normal text. */
export const AA_TEXT = 4.5;

export type ThemeName = "light" | "dark";

interface ThemeRule {
  /** Surfaces the colour is read on as text (`text-primary`). */
  surfaces: readonly string[];
  /** The `bg-primary/NN` tints it is read on, over each surface. */
  tints: readonly number[];
  /** Candidate `--primary-foreground`s, in order of preference. */
  foregrounds: readonly string[];
  /** Which way lightness moves to gain contrast. */
  direction: -1 | 1;
}

/** Mirrors globals.css (checked by brandColor.test.ts). */
export const THEME_SURFACES: Record<ThemeName, Record<string, string>> = {
  light: { background: "#f8fafc", card: "#ffffff", muted: "#f1f5f9" },
  dark: { background: "#0f172a", card: "#1e293b", muted: "#1e293b" },
};

const RULES: Record<ThemeName, ThemeRule> = {
  // ADR-090: as text on the page, the card and its own /10 and /15 tint; the
  // default light primary carries white text.
  light: {
    surfaces: Object.values(THEME_SURFACES.light),
    tints: [0.1, 0.15],
    foregrounds: ["#ffffff", "#0f172a"],
    direction: -1,
  },
  // ADR-090: as text on the page, the card and its own /10 tint; the dark
  // primary is a light fill with dark text.
  dark: {
    surfaces: Object.values(THEME_SURFACES.dark),
    tints: [0.1],
    foregrounds: ["#0f172a", "#ffffff"],
    direction: 1,
  },
};

/** The lowest contrast of `c` as text anywhere the theme uses `--primary`. */
export const worstTextContrast = (c: Rgb, theme: ThemeName): number => {
  const rule = RULES[theme];
  let worst = Infinity;
  for (const s of rule.surfaces) {
    const under = parseHex(s) as Rgb;
    worst = Math.min(worst, contrastRatio(c, under));
    for (const a of rule.tints) worst = Math.min(worst, contrastRatio(c, tint(c, under, a)));
  }
  return worst;
};

// --- HSL, so only lightness moves --------------------------------------------

const toHsl = ([r, g, b]: Rgb): [number, number, number] => {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === R) h = (G - B) / d + (G < B ? 6 : 0);
  else if (max === G) h = (B - R) / d + 2;
  else h = (R - G) / d + 4;
  return [h / 6, s, l];
};

const fromHsl = ([h, s, l]: [number, number, number]): Rgb => {
  if (s === 0) return [l * 255, l * 255, l * 255].map(Math.round) as Rgb;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return [channel(h + 1 / 3), channel(h), channel(h - 1 / 3)].map((v) => Math.round(v * 255)) as Rgb;
};

export interface ThemedBrand {
  /** The `--primary` this theme uses. */
  primary: string;
  /** The `--primary-foreground` on it. */
  foreground: string;
  /** Whether `primary` differs from the tenant's colour. */
  adjusted: boolean;
  /** The lowest text contrast of `primary` in this theme (≥ 4.5). */
  textContrast: number;
  /** The contrast of `foreground` on `primary` (≥ 4.5). */
  fillContrast: number;
}

/** The accessible form of a brand colour in one theme. */
export const brandForTheme = (brand: Rgb, theme: ThemeName): ThemedBrand => {
  const rule = RULES[theme];
  let candidate = brand;
  if (worstTextContrast(brand, theme) < AA_TEXT) {
    const [h, s, l0] = toHsl(brand);
    // Step lightness toward black (light theme) or white (dark theme). The
    // loop ends: pure black passes the light rule (≥ 17:1 on every light
    // surface and tint) and pure white the dark one.
    for (let step = 1; step <= 100; step++) {
      const l = Math.min(1, Math.max(0, l0 + rule.direction * step * 0.01));
      candidate = fromHsl([h, s, l]);
      if (worstTextContrast(candidate, theme) >= AA_TEXT) break;
      if (l === 0 || l === 1) break;
    }
  }
  const primary = toHex(candidate);
  const fg =
    rule.foregrounds.find((f) => contrastRatio(parseHex(f) as Rgb, candidate) >= AA_TEXT) ??
    rule.foregrounds[0];
  return {
    primary,
    foreground: fg,
    adjusted: primary.toLowerCase() !== toHex(brand).toLowerCase(),
    textContrast: worstTextContrast(candidate, theme),
    fillContrast: contrastRatio(parseHex(fg) as Rgb, candidate),
  };
};

export type BrandPalette = Record<ThemeName, ThemedBrand>;

/** Both themes' accessible `--primary` for a `#RRGGBB` brand colour, or null. */
export const accessibleBrandPalette = (value: string | null | undefined): BrandPalette | null => {
  const brand = parseHex(value);
  if (!brand) return null;
  return { light: brandForTheme(brand, "light"), dark: brandForTheme(brand, "dark") };
};

/**
 * The custom properties `TenantBrandingProvider` sets on <html>. globals.css
 * reads them only under `html[data-tenant-brand]`, per theme, so switching
 * theme needs no script.
 */
export const BRAND_PROPERTIES = {
  lightPrimary: "--brand-primary-light",
  lightForeground: "--brand-primary-foreground-light",
  darkPrimary: "--brand-primary-dark",
  darkForeground: "--brand-primary-foreground-dark",
} as const;
export const BRAND_ATTRIBUTE = "data-tenant-brand";
