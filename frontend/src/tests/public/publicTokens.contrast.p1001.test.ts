/**
 * P10-01 (ADR-098 §3, doc 20 §4.2) — the public palette's contrast, computed
 * from the SHIPPED CSS (src/app/public-surface.css), not asserted in a document.
 *
 *  1. Every pairing the page uses meets its threshold: 4.5:1 for text, 3:1 for
 *     control boundaries and the focus ring (WCAG 2.1 SC 1.4.3, 1.4.11).
 *  2. Every hex and every ratio in doc 20 §4.2's Foreground and Status tables
 *     equals what the CSS computes (±0.01) — so the table cannot drift from the
 *     code in either direction.
 *  3. The forbidden pairings the doc names really do fail (white on the accent,
 *     the navy mark on the background, --pub-border as an input boundary).
 */
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../../..");
const css = fs.readFileSync(path.join(root, "src/app/public-surface.css"), "utf8");
const doc = fs.readFileSync(path.join(root, "../docs/UI-UX/20-LANDING-AUTH-REVAMP.md"), "utf8");

const tokens: Record<string, string> = {};
for (const m of css.matchAll(/(--pub-[a-z-]+):\s*(#[0-9A-Fa-f]{6})\s*;/g)) tokens[m[1]] = m[2].toUpperCase();

const channel = (c: number) => {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const luminance = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
};
/** WCAG 2.1 contrast ratio. */
export const ratio = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const tok = (name: string) => {
  const v = tokens[name];
  if (!v) throw new Error(`${name} is not defined as a #RRGGBB literal in public-surface.css`);
  return v;
};

const SURFACES = ["--pub-bg", "--pub-surface", "--pub-raised"];

describe("P10-01: public palette contrast, computed from public-surface.css", () => {
  it.each([
    ["--pub-text", [...SURFACES, "--pub-glow"]],
    ["--pub-text-muted", [...SURFACES, "--pub-glow"]],
    ["--pub-text-subtle", [...SURFACES, "--pub-glow"]],
    ["--pub-accent", [...SURFACES, "--pub-glow"]],
    ["--pub-accent-hover", SURFACES],
    ["--pub-success", SURFACES],
    ["--pub-warning", SURFACES],
    ["--pub-danger", [...SURFACES, "--pub-glow"]],
    ["--pub-neutral", SURFACES],
  ])("%s is text-legible (≥ 4.5:1) on every surface it sits on", (fg, bgs) => {
    for (const bg of bgs as string[]) expect([fg, bg, ratio(tok(fg), tok(bg)) >= 4.5]).toEqual([fg, bg, true]);
  });

  it("the primary button's label (--pub-on-accent) is legible on accent, hover and pressed", () => {
    for (const fill of ["--pub-accent", "--pub-accent-hover", "--pub-accent-pressed"]) {
      expect([fill, ratio(tok("--pub-on-accent"), tok(fill)) >= 4.5]).toEqual([fill, true]);
    }
  });

  it("control boundaries (--pub-border-strong) and the focus ring (--pub-accent) reach 3:1", () => {
    for (const bg of SURFACES) {
      expect(ratio(tok("--pub-border-strong"), tok(bg))).toBeGreaterThanOrEqual(3);
      expect(ratio(tok("--pub-accent"), tok(bg))).toBeGreaterThanOrEqual(3);
    }
  });

  it("the forbidden pairings really fail, so they stay forbidden", () => {
    expect(ratio("#FFFFFF", tok("--pub-accent"))).toBeLessThan(3);
    expect(ratio("#001250", tok("--pub-bg"))).toBeLessThan(3);
    expect(ratio(tok("--pub-border"), tok("--pub-raised"))).toBeLessThan(3);
  });

  it("inputs use --pub-border-strong, never --pub-border, as their boundary", () => {
    const input = css.match(/\.pub-input \{[^}]*\}/);
    expect(input?.[0]).toMatch(/border: 1px solid var\(--pub-border-strong\)/);
  });

  it("doc 20 §4.2's hexes and ratios equal what the CSS computes", () => {
    const section = doc.slice(doc.indexOf("### 4.2"), doc.indexOf("### 4.3"));
    const rows = [...section.matchAll(/^\| `(--pub-[a-z-]+)` \| `(#[0-9A-Fa-f]{6})` \|(.*)$/gm)];
    expect(rows.length).toBeGreaterThanOrEqual(15);
    let checked = 0;
    for (const [, name, hex, rest] of rows) {
      expect([name, tok(name)]).toEqual([name, hex.toUpperCase()]);
      const cells = rest.split("|").map((c) => c.replace(/\*/g, "").trim());
      // Foreground rows: bg, surface, raised, glow. Status rows: bg, surface, raised.
      const against = ["--pub-bg", "--pub-surface", "--pub-raised", "--pub-glow"];
      cells.slice(0, 4).forEach((cell, i) => {
        if (!/^\d+(\.\d+)?$/.test(cell) || !tokens[against[i]]) return;
        expect([name, against[i], Math.round(ratio(tok(name), tok(against[i])) * 100) / 100]).toEqual([
          name,
          against[i],
          Number(cell),
        ]);
        checked += 1;
      });
    }
    expect(checked).toBeGreaterThanOrEqual(37); // every numeric cell of the two tables on 2026-09-30
  });
});
