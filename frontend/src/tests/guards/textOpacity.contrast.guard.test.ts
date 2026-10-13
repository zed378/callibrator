/**
 * Contrast guard (2026-10-13, after `e076d1a`): text is never faded with opacity.
 *
 * `opacity-80` on a count inside a selected (primary-filled) control measured
 * 4.43:1 on the IPM capture (axe, P22 browser suite) — the fade blends the text
 * toward the fill, and no token says what the result is. The same pattern sat on
 * `/dashboard/access-requests`. A secondary part of a label is made quieter with
 * weight (`font-normal`) or size, never with opacity; a hover is a token
 * (`hover:bg-primary-hover`) or an underline, never a fade.
 *
 * Scans every non-test `.ts`/`.tsx` file under `app/**` and `components/**` for:
 *
 *   opacity   an `opacity-N` (0 < N < 100), bare or behind a state variant
 *             (`hover:`, `focus:`, `group-hover:` …), in the class list of an
 *             element that can hold text: a lowercase HTML element other than
 *             the SVG ones, or one of the text components (`Link`, `Button`,
 *             `Badge`). Icons (other capitalised components) and SVG parts are
 *             graphics, not text. A `disabled:` variant is exempt: WCAG 1.4.3
 *             does not cover an inactive control.
 *   alpha     a translucent text colour, `text-<token>/N` (bare or behind a state
 *             variant; `placeholder:` and `disabled:` exempt). The colour guard's
 *             `faded` rule covers only the `*-foreground` tokens; this covers all.
 *
 * A finding passes only if `EXEMPT` below names it (file, the class literal, and
 * why it carries no text). The fixtures prove each form fires and each exemption
 * still matches (CLAUDE.md "Evidence").
 */
import fs from "fs";
import path from "path";

const SRC = path.resolve(__dirname, "../..");
const ROOTS = ["app", "components"];

/** Capitalised components that render text in their own box. */
const TEXT_COMPONENTS = new Set(["Link", "Button", "Badge"]);
/** Lowercase elements that are graphics. */
const SVG_TAGS = new Set(["svg", "circle", "path", "rect", "g", "line", "polyline", "polygon", "ellipse", "use"]);

/** Reviewed findings: an element with opacity that holds no text. */
const EXEMPT: ReadonlyArray<{ file: string; literal: string; reason: string }> = [
  { file: "app/(app)/dashboard/components/grid-background.tsx", literal: "opacity-30", reason: "decorative grid layer, no text" },
  { file: "app/(app)/dashboard/components/grid-background.tsx", literal: "opacity-20", reason: "decorative orb, no text" },
  { file: "app/(app)/dashboard/components/grid-background.tsx", literal: "opacity-15", reason: "decorative orb, no text" },
  { file: "app/(app)/dashboard/components/grid-background.tsx", literal: "opacity-10", reason: "decorative orb, no text" },
  { file: "app/(app)/dashboard/components/stat-card.tsx", literal: "opacity-60", reason: "a 2 px gradient bar, no text" },
  { file: "app/(app)/not-found.tsx", literal: "opacity-75", reason: "the ping ring of a status dot, no text" },
  { file: "components/motion/AuroraBackground.tsx", literal: "opacity-60", reason: "decorative background layer, no text" },
  { file: "components/motion/AuroraBackground.tsx", literal: "dark:opacity-40", reason: "the same layer in the dark theme" },
  { file: "components/public/landing/QrVerifyDemo.tsx", literal: "opacity-25", reason: "a QR graphic under an aria-hidden viewfinder" },
  { file: "components/ui/MultiSelect.tsx", literal: "opacity-60", reason: "the disabled state (WCAG 1.4.3 exempts an inactive control)" },
  { file: "app/(app)/dashboard/kanban/[projectId]/components/CardTile.tsx", literal: "opacity-40", reason: "the drag source while it is dragged (a transient ghost; the overlay shows the card at full strength)" },
];

interface Finding {
  kind: "opacity" | "alpha";
  line: number;
  tag: string;
  literal: string;
}

const lineOf = (text: string, index: number) => text.slice(0, index).split("\n").length;

/** The JSX tag whose attributes contain `index`: the last `<Tag` opened before it. */
const tagAt = (text: string, index: number): string => {
  const before = text.slice(0, index);
  const re = /<([A-Za-z][\w.]*)\b/g;
  let tag = "";
  for (const m of before.matchAll(re)) tag = m[1] ?? "";
  return tag;
};

const holdsText = (tag: string): boolean =>
  /^[a-z]/.test(tag) ? !SVG_TAGS.has(tag) : TEXT_COMPONENTS.has(tag);

const scanTextOpacity = (text: string): Finding[] => {
  const out: Finding[] = [];
  // Every class-like token: an optional variant chain, then the utility.
  for (const m of text.matchAll(/(?<![\w-])((?:[\w-]+(?:\[[^\]\s]*\])?:)*)opacity-(\d+)\b/g)) {
    const variants = m[1] ?? "";
    const value = Number(m[2]);
    if (value === 0 || value >= 100 || /disabled/.test(variants)) continue;
    const tag = tagAt(text, m.index);
    if (!holdsText(tag)) continue;
    out.push({ kind: "opacity", line: lineOf(text, m.index), tag, literal: `${variants}opacity-${m[2]}` });
  }
  for (const m of text.matchAll(/(?<![\w-])((?:[\w-]+(?:\[[^\]\s]*\])?:)*)text-([a-z][a-z-]*)\/(\d+)\b/g)) {
    const variants = m[1] ?? "";
    if (/placeholder|disabled/.test(variants)) continue;
    out.push({ kind: "alpha", line: lineOf(text, m.index), tag: tagAt(text, m.index), literal: `${variants}text-${m[2]}/${m[3]}` });
  }
  return out;
};

const files = (): string[] => {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== "__tests__") walk(p);
      } else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.|\.d\.ts$/.test(e.name)) {
        out.push(p);
      }
    }
  };
  for (const r of ROOTS) walk(path.join(SRC, r));
  return out;
};

const rel = (abs: string) => path.relative(SRC, abs).split(path.sep).join("/");
const exempt = (file: string, f: Finding) => EXEMPT.some((e) => e.file === file && e.literal === f.literal);

describe("text is never faded with opacity (contrast, after e076d1a)", () => {
  const all = files();

  it("scans app/** and components/**", () => {
    expect(all.length).toBeGreaterThan(350);
  });

  it("no opacity on a text element and no translucent text colour, outside the reviewed exemptions", () => {
    const found: string[] = [];
    for (const f of all) {
      const r = rel(f);
      for (const x of scanTextOpacity(fs.readFileSync(f, "utf8"))) {
        if (!exempt(r, x)) found.push(`${r}:${x.line} ${x.kind} <${x.tag}> ${x.literal}`);
      }
    }
    expect(found).toEqual([]);
  });

  it("every exemption still matches a finding (none is stale)", () => {
    const stale = EXEMPT.filter((e) => {
      const abs = path.join(SRC, e.file);
      if (!fs.existsSync(abs)) return true;
      return !scanTextOpacity(fs.readFileSync(abs, "utf8")).some((x) => x.literal === e.literal);
    });
    expect(stale).toEqual([]);
  });
});

describe("text opacity guard: each form is caught (fixture)", () => {
  it.each([
    ["opacity", `<span className="ml-1.5 opacity-80">({count})</span>`],
    ["opacity", "<button className={`px-3 ${on ? \"bg-primary\" : \"\"}`}>{label}<span className=\"ml-1 opacity-70\">3</span></button>"],
    ["opacity", `<Link href="/x" className="bg-primary text-primary-foreground hover:opacity-90">Start</Link>`],
    ["opacity", `<p className="text-sm group-hover:opacity-60">x</p>`],
    ["alpha", `<button className="text-primary hover:text-primary/80">Use a recovery code</button>`],
    ["alpha", `<Button className="text-destructive/80">Remove</Button>`],
    ["alpha", `<td className="text-muted-foreground/70">—</td>`],
  ])("%s: %s", (kind, sample) => {
    expect(scanTextOpacity(sample).map((f) => f.kind)).toContain(kind);
  });

  it.each([
    `<Inbox className="w-10 h-10 mx-auto mb-3 opacity-40" aria-hidden="true" />`,
    `<circle className="opacity-25" cx="12" cy="12" r="10" />`,
    `<button className="disabled:opacity-50 bg-primary text-primary-foreground">Save</button>`,
    `<div className="opacity-0 group-hover:opacity-100 transition-opacity">x</div>`,
    `<input className="placeholder:text-muted-foreground/60" />`,
    `<span className="ml-1.5 font-normal">(3)</span>`,
    `<Link className="bg-primary text-primary-foreground hover:bg-primary-hover">Start</Link>`,
    `<div className="bg-primary/10 text-primary">icon</div>`,
  ])("allowed: %s", (sample) => {
    expect(scanTextOpacity(sample)).toEqual([]);
  });
});
