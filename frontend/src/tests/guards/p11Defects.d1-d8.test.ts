/**
 * P11-03 / P11-04 / P11-06 (ADR-122): the existing contrast defects the P11-00
 * audit measured (spec §3.5), each pinned by the CLASSES its element really
 * uses, resolved against globals.css in BOTH themes.
 *
 * jsdom has no layout, so axe cannot see these; the browser sweep did not
 * open these states. The test reads the element's class string from the
 * component source (an anchor unique to that element), resolves each colour
 * class to a value — a semantic token from globals.css, or the literal
 * `white` / `black` the old code used — and computes WCAG 2.x contrast.
 *
 * Fail-before (HEAD 4584df3), with the same resolver:
 *   D1 backup inputs        `bg-white text-foreground`      1.23:1 dark
 *   D2 SSO panel heading    `text-white` on `bg-background`  1.05:1 light
 *   D3 dropdown panel       `bg-white/95 text-foreground`    1.11:1 dark
 *   D7 notification time    `text-muted-foreground/70`       3.59 / 3.56
 *   D8 impersonation banner `text-amber-700` on amber-500/15  (palette class: no token, refused)
 * D4 (control boundaries) and D5 (priority series) are pinned in
 * components/ui/a11y.adr090.test.tsx; D6 in lib/readableOn.test.ts.
 */
import fs from "fs";
import path from "path";

type Rgb = [number, number, number];
const SRC = path.resolve(__dirname, "../..");
const css = fs.readFileSync(path.join(SRC, "app/globals.css"), "utf8");

const hex = (h: string): Rgb => {
  const n = parseInt(h.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const lum = (c: Rgb) => {
  const [r, g, b] = c.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: Rgb, b: Rgb) => {
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
const over = (c: Rgb, under: Rgb, alpha: number): Rgb =>
  c.map((v, i) => Math.round(v * alpha + under[i] * (1 - alpha))) as Rgb;

const block = (selector: string): Record<string, string> => {
  const re = new RegExp(`^${selector.replace(".", "\\.")} \\{([^}]*)\\}`, "gm");
  for (const m of css.matchAll(re)) {
    if (!m[1].includes("--background:")) continue;
    const out: Record<string, string> = {};
    for (const t of m[1].matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})/g)) out[t[1]] = t[2];
    return out;
  }
  throw new Error(`no ${selector} block`);
};
const THEMES = { light: block(":root"), dark: block(".dark") } as const;
type Theme = keyof typeof THEMES;

/** A colour name from a class (`foreground`, `card`, `white`) in a theme; throws on a palette class. */
const colour = (name: string, theme: Theme): Rgb => {
  if (name === "white") return [255, 255, 255];
  if (name === "black") return [0, 0, 0];
  const v = THEMES[theme][name];
  if (!v) throw new Error(`"${name}" is not a theme token (a raw palette colour?)`);
  return hex(v);
};

/** The text colour and background of a class string, the background composited over `ground`. */
const resolve = (classes: string, theme: Theme, ground: string) => {
  const base = colour(ground, theme);
  const bgm = /(?:^|\s)bg-([a-z0-9-]+?)(?:\/(\d+))?(?=\s|$)/.exec(classes);
  const bg = bgm ? over(colour(bgm[1], theme), base, bgm[2] ? Number(bgm[2]) / 100 : 1) : base;
  const tm = /(?:^|\s)text-([a-z0-9-]+?)(?:\/(\d+))?(?=\s|$)/.exec(classes.replace(/text-(xs|sm|base|lg|xl|\dxl|\[[^\]]+\])/g, ""));
  if (!tm) throw new Error(`no text colour in "${classes}"`);
  const text = tm[2] ? over(colour(tm[1], theme), bg, Number(tm[2]) / 100) : colour(tm[1], theme);
  return { text, bg };
};

/** The className string of the element at `anchor` in a component's source. */
const classesAt = (file: string, anchor: RegExp): string => {
  const source = fs.readFileSync(path.join(SRC, file), "utf8");
  const m = anchor.exec(source);
  if (!m?.[1]) throw new Error(`${file}: anchor ${String(anchor)} not found`);
  return m[1];
};

const AA = 4.5;

describe("P11 defects D1–D3, D7, D8: text on its own background, both themes (ADR-122)", () => {
  const cases: [string, string, RegExp, string][] = [
    [
      "D1 backup form inputs",
      "app/dashboard/tenants/[tenantId]/backup/components/BackupCreateModal.tsx",
      /className="(w-full px-3 py-2 border[^"]*)"/,
      "card", // the dialog panel
    ],
    [
      "D2 SSO panel heading",
      "app/dashboard/tenants/components/SsoSettingsPanel.tsx",
      /<h2 id=\{titleId\} className="([^"]*)"/,
      "background", // the panel is bg-background
    ],
    [
      "D3 searchable dropdown panel",
      "components/ui/SearchableDropdown.tsx",
      /className="(absolute z-50 left-0 right-0 mt-2[^"]*)"/,
      "background",
    ],
    [
      "D7 notification timestamp",
      "components/layouts/NotificationBell.tsx",
      /<span className="(block text-\[10px\][^"]*)">/,
      "card", // the panel is bg-card
    ],
    [
      "D8 impersonation banner",
      "components/layouts/ImpersonationBanner.tsx",
      /className="(flex flex-wrap items-center justify-between gap-2[^"]*)"/,
      "background",
    ],
  ];

  it.each(cases.flatMap(([name, file, anchor, ground]) => (["light", "dark"] as const).map((t) => [name, t, file, anchor, ground] as const)))(
    "%s reads at 4.5:1 in %s",
    (_name, theme, file, anchor, ground) => {
      const { text, bg } = resolve(classesAt(file, anchor), theme, ground);
      expect(ratio(text, bg)).toBeGreaterThanOrEqual(AA);
    },
  );

  it("D1: the backup inputs draw a 3:1 control boundary (border-input) on the card", () => {
    const classes = classesAt(
      "app/dashboard/tenants/[tenantId]/backup/components/BackupCreateModal.tsx",
      /className="(w-full px-3 py-2 border[^"]*)"/,
    );
    expect(classes).toMatch(/\bborder-input\b/);
    for (const theme of ["light", "dark"] as const) {
      expect(ratio(colour("input", theme), colour("card", theme))).toBeGreaterThanOrEqual(3);
    }
  });

  it("the resolver refuses what the old code used (so the fail-before is real)", () => {
    // D2 before: white text on the light page.
    expect(ratio(colour("white", "light"), colour("background", "light"))).toBeLessThan(1.1);
    // D1 before: the theme's light text on a white input in dark mode.
    expect(ratio(colour("foreground", "dark"), colour("white", "dark"))).toBeLessThan(1.3);
    // D8 before: a palette class is not a token.
    expect(() => resolve("bg-amber-500/15 text-amber-700", "light", "background")).toThrow(/not a theme token/);
  });
});
