/**
 * ADR-118 Amendment 2 (P10-17): the logo follows the warm palette.
 *
 * Pins three things a later edit could quietly undo:
 *  1. BrandIcon takes its accent from the theme (`.logo-accent`), not a fixed
 *     teal, and the explicit `accent` override still works for a mono render.
 *  2. The shipped brand files carry only the warm palette (lockup-mono stays
 *     mono), and no file reintroduces the retired navy #001250 / teal #00DAB4.
 *  3. Every logo colour clears 3:1 (WCAG 1.4.11, non-text) against the
 *     surface it is drawn on — computed here, not copied from the record.
 */
import fs from "fs";
import path from "path";
import React from "react";
import { render } from "@testing-library/react";
import { BrandIcon } from "../BrandIcon";

const ROOT = path.join(__dirname, "../../../..");
const brand = (f: string) => fs.readFileSync(path.join(ROOT, "public/brand", f), "utf8");
const globals = fs.readFileSync(path.join(ROOT, "src/app/globals.css"), "utf8");

const lum = (hex: string) => {
  const c = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
const fills = (svg: string) =>
  Object.fromEntries([...svg.matchAll(/\.(\w+)\s*\{\s*fill:\s*(#[0-9A-Fa-f]{6})\s*\}/g)].map((m) => [m[1], m[2]]));

describe("BrandIcon (ADR-118 Am. 2)", () => {
  it("draws the accent from the theme rule, never a fixed colour", () => {
    const { container } = render(<BrandIcon className="text-logo-ink" />);
    const accents = container.querySelectorAll(".logo-accent");
    expect(accents).toHaveLength(4);
    for (const el of accents) expect(el.getAttribute("fill")).toBeNull();
    expect(container.innerHTML).not.toMatch(/#00DAB4|#001250/i);
  });

  it("still honours an explicit accent for a monochrome rendering", () => {
    const { container } = render(<BrandIcon accent="#000000" />);
    expect(container.querySelectorAll(".logo-accent")).toHaveLength(0);
    expect(container.querySelectorAll('[fill="#000000"]')).toHaveLength(4);
  });

  it("the theme rule prefers the public accent, then the logo token", () => {
    expect(globals).toMatch(/\.logo-accent\s*\{\s*fill:\s*var\(--pub-accent,\s*var\(--logo-accent\)\);/);
  });
});

describe("brand files carry the warm palette", () => {
  const LIGHT = { body: "#1F1B17", accent: "#9A4E22" };
  const DARK = { body: "#F6EFE4", accent: "#E3A47B" };

  it.each([
    ["mark.svg", LIGHT],
    ["lockup-light.svg", LIGHT],
    ["mark-dark.svg", DARK],
    ["lockup-dark.svg", { tile: "#241E19", ...DARK }],
    ["app-icon.svg", { tile: "#241E19", ...DARK }],
  ])("%s", (file, expected) => {
    const svg = brand(file);
    expect(fills(svg)).toEqual(expected);
    expect(svg).not.toMatch(/#00DAB4|#001250/i);
  });

  it("lockup-mono.svg stays monochrome", () => {
    const used = new Set([...brand("lockup-mono.svg").matchAll(/class="(\w+)"/g)].map((m) => m[1]));
    expect([...used].sort()).toEqual(["ink", "white"]);
  });
});

describe("logo colours clear 3:1 against their surface (WCAG 1.4.11)", () => {
  // Surfaces: the public ivory and cream, the inverted warm charcoal, the
  // dashboard card and sidebar in light and dark (globals.css, ADR-122).
  it.each([
    ["charcoal on ivory", "#1F1B17", "#FBF7F0"],
    ["copper on ivory", "#9A4E22", "#FBF7F0"],
    ["copper on cream", "#9A4E22", "#F4ECDF"],
    ["ivory on inverted charcoal", "#F6EFE4", "#241E19"],
    ["light copper on inverted charcoal", "#E3A47B", "#241E19"],
    ["charcoal on the light card", "#1F1B17", "#FFFDF9"],
    ["copper on the light card", "#9A4E22", "#FFFDF9"],
    ["ivory on the dark card", "#F6EFE4", "#23201C"],
    ["light copper on the dark card", "#E3A47B", "#23201C"],
    // ADR-122: the mark sits in the sidebar, one step off the card.
    ["charcoal on the light sidebar", "#1F1B17", "#F5F2ED"],
    ["copper on the light sidebar", "#9A4E22", "#F5F2ED"],
    ["ivory on the dark sidebar", "#F6EFE4", "#1E1B17"],
    ["light copper on the dark sidebar", "#E3A47B", "#1E1B17"],
  ])("%s", (_label, fg, bg) => {
    expect(ratio(fg, bg)).toBeGreaterThanOrEqual(3);
  });

  it("copper itself fails on the inverted charcoal — which is why dark uses the light copper", () => {
    expect(ratio("#9A4E22", "#241E19")).toBeLessThan(3);
  });
});
