/**
 * ADR-090 amendment — a tenant's brand colour is turned into one accessible
 * `--primary` per theme.
 *
 * Fail-before: TenantBrandingProvider wrote the tenant's colour straight into
 * `--primary` (both themes) and picked black/white text by a luminance guess.
 * `#ffff00` read at 1.07:1 as text on the light card, `#1e3a8a` at 1.6:1 on
 * the dark card.
 */
import fs from "fs";
import path from "path";
import {
  AA_TEXT,
  THEME_SURFACES,
  accessibleBrandPalette,
  contrastRatio,
  parseHex,
  tint,
  type Rgb,
} from "./brandColor";

const hex = (h: string) => parseHex(h) as Rgb;

/** Every way ADR-090 says the primary is read, independently of the module's own loop. */
const assertThemeRule = (primary: string, fg: string, theme: "light" | "dark") => {
  const c = hex(primary);
  const tints = theme === "light" ? [0.1, 0.15] : [0.1];
  for (const surface of Object.values(THEME_SURFACES[theme])) {
    const under = hex(surface);
    expect(contrastRatio(c, under)).toBeGreaterThanOrEqual(AA_TEXT);
    for (const a of tints) expect(contrastRatio(c, tint(c, under, a))).toBeGreaterThanOrEqual(AA_TEXT);
  }
  expect(contrastRatio(hex(fg), c)).toBeGreaterThanOrEqual(AA_TEXT);
};

// Hue of the input vs. the output, in degrees (grey has none).
const hue = ([r, g, b]: Rgb): number | null => {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max - min < 8) return null;
  const d = max - min;
  let h = max === r ? (g - b) / d : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
};

describe("accessibleBrandPalette (ADR-090 amendment)", () => {
  it("the surfaces it checks against are the ones in globals.css", () => {
    const css = fs.readFileSync(path.join(__dirname, "../app/globals.css"), "utf8");
    const block = (selector: RegExp) => {
      for (const m of css.matchAll(selector)) if (m[1].includes("--background:")) return m[1];
      throw new Error("theme block not found");
    };
    const light = block(/^:root \{([^}]*)\}/gm);
    const dark = block(/^\.dark \{([^}]*)\}/gm);
    for (const [theme, text] of [["light", light], ["dark", dark]] as const) {
      for (const [name, value] of Object.entries(THEME_SURFACES[theme])) {
        const m = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(text);
        expect(m?.[1].toLowerCase()).toBe(value);
      }
    }
  });

  it("keeps a colour that already passes exactly as chosen", () => {
    // The default light primary (blue-700) passes the light rule.
    const p = accessibleBrandPalette("#1d4ed8")!;
    expect(p.light).toMatchObject({ primary: "#1d4ed8", foreground: "#ffffff", adjusted: false });
    // The default dark primary (blue-400) passes the dark rule.
    expect(accessibleBrandPalette("#60a5fa")!.dark).toMatchObject({
      primary: "#60a5fa",
      foreground: "#0f172a",
      adjusted: false,
    });
  });

  // A sweep of hues and lightnesses, plus the extremes.
  const samples = ["#ffff00", "#ffffff", "#000000", "#808080", "#1e3a8a", "#7dd3fc", "#ef4444", "#10b981",
    "#f59e0b", "#a855f7", "#ec4899", "#0a1f44", "#fafafa", "#111111"];
  for (let h = 0; h < 360; h += 30) {
    for (const l of [20, 50, 80]) samples.push(`hsl-${h}-${l}`);
  }
  const toHexSample = (s: string) => {
    if (s.startsWith("#")) return s;
    const [, h, l] = s.split("-").map(Number);
    // CSS hsl(h 80% l%) → rgb, for the sweep only.
    const a = 0.8 * Math.min(l / 100, 1 - l / 100);
    const f = (n: number) => {
      const k = (n + h / 30) % 12;
      return Math.round(255 * (l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
    };
    return `#${[f(0), f(8), f(4)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
  };

  it.each(samples.map(toHexSample))("%s: both themes meet the ADR-090 rule", (colour) => {
    const p = accessibleBrandPalette(colour)!;
    assertThemeRule(p.light.primary, p.light.foreground, "light");
    assertThemeRule(p.dark.primary, p.dark.foreground, "dark");
    expect(p.light.textContrast).toBeGreaterThanOrEqual(AA_TEXT);
    expect(p.dark.fillContrast).toBeGreaterThanOrEqual(AA_TEXT);
    // ADR-122: the hover and pressed fills carry the same text at 4.5:1 too.
    for (const t of [p.light, p.dark]) {
      expect(contrastRatio(hex(t.foreground), hex(t.hover))).toBeGreaterThanOrEqual(AA_TEXT);
      expect(contrastRatio(hex(t.foreground), hex(t.pressed))).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });

  it("derives hover and pressed shades darker in light and lighter in dark (ADR-122)", () => {
    const p = accessibleBrandPalette("#1d4ed8")!;
    const l = (c: string) => hex(c).reduce((a, b) => a + b, 0);
    expect(l(p.light.hover)).toBeLessThan(l(p.light.primary));
    expect(l(p.light.pressed)).toBeLessThan(l(p.light.hover));
    const d = accessibleBrandPalette("#60a5fa")!.dark;
    expect(l(d.hover)).toBeGreaterThan(l(d.primary));
    expect(l(d.pressed)).toBeGreaterThan(l(d.hover));
  });

  it.each(["#ffff00", "#ef4444", "#7dd3fc", "#1e3a8a", "#a855f7"])(
    "%s: an adjusted shade keeps the brand's hue",
    (colour) => {
      const p = accessibleBrandPalette(colour)!;
      const h0 = hue(hex(colour))!;
      for (const t of [p.light, p.dark]) {
        const h1 = hue(hex(t.primary));
        if (h1 === null) continue; // pushed to near-black/white: no hue left to keep
        const diff = Math.min(Math.abs(h1 - h0), 360 - Math.abs(h1 - h0));
        expect(diff).toBeLessThan(12);
      }
    },
  );

  it("moves the light shade darker and the dark shade lighter, never the other way", () => {
    const yellow = accessibleBrandPalette("#ffff00")!;
    expect(yellow.light.adjusted).toBe(true);
    expect(contrastRatio(hex(yellow.light.primary), hex("#ffffff"))).toBeGreaterThanOrEqual(AA_TEXT);
    expect(yellow.dark.adjusted).toBe(false); // yellow is already fine on dark
    const navy = accessibleBrandPalette("#1e3a8a")!;
    expect(navy.light.adjusted).toBe(false);
    expect(navy.dark.adjusted).toBe(true);
  });

  it.each([null, undefined, "", "red", "#fff", "#12345"])("returns null for %p", (v) => {
    expect(accessibleBrandPalette(v as string | null | undefined)).toBeNull();
  });
});
