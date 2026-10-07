/**
 * P11-01 (ADR-122): the app colours through semantic tokens only.
 *
 * Scans every non-test `.ts`/`.tsx` file under `app/**` and `components/**`
 * (until 2026-10-07 only the dashboard tree: `app/dashboard/**`,
 * `components/{layouts,ui,editor,errors,icons,motion}`, `AccessDeniedModal`,
 * `ThemeToggle`, `TenantBrandingProvider`; ADR-122 Amendment 1 grew it to the
 * public pages and `components/public/**`) for raw colour:
 *
 *   hex       a `#rgb` / `#rgba` / `#rrggbb` / `#rrggbbaa` literal
 *   fn        `rgb(`, `rgba(`, `hsl(`, `hsla(`, `oklch(`, `oklab(`
 *   palette   a Tailwind palette class (`bg-amber-500`, `text-slate-600`, …)
 *   wb        a `white` / `black` colour utility (`bg-black/50`, `text-white`)
 *   arbitrary an arbitrary colour value (`bg-[#…]`, `-[rgb…`, `-[color:…`)
 *   dark      a `dark:` colour variant (the token flips; a variant bypasses it)
 *   faded     faded text tokens (`text-muted-foreground/70`): contrast unverified
 *   blend     a gradient across two hues (`from-primary to-accent`); one-token
 *             gradients and fades into a neutral surface stay allowed
 *
 * A finding passes only if `constants/colourExemptions.ts` lists it (file,
 * literal, exact count, reason). It shipped as a ratchet seeded with the
 * per-file counts of 2026-10-06 (spec P11-00 §3.3, re-counted by these
 * patterns: 18 hex, 13 palette, 48 white/black, 3 `dark:`, 12 faded = 94
 * findings; 14 of them on the allow-list, so the ratchet held 80 in 40
 * files). P11-03 took the shell and components/ui to zero, P11-04 and P11-06
 * the modules; BASELINE is now empty and every finding outside the allow-list
 * fails. (The allow-list holds 17 after P11-04: the kanban fallback colour is
 * now also passed to lib/readableOn.) When the scope grew (Amendment 1) the
 * new files held 15 findings in 5 files (not-found, oauth/consent,
 * sso-callback: 6 blends + 1 faded; BrandIcon: 4 hex in a comment; BrandMark:
 * white/black); all were fixed except BrandMark's logo plate (allow-listed).
 *
 * The patterns are written from the forbidden forms, not from the sweep, and a
 * fixture with one of each proves they fire (CLAUDE.md "Evidence").
 */
import fs from "fs";
import path from "path";
import { COLOUR_EXEMPTIONS } from "@/constants/colourExemptions";

const SRC = path.resolve(__dirname, "../..");

/**
 * P11 follow-up (ADR-122 Amendment 1, 2026-10-07): the scan covers ALL of
 * `app/**` and `components/**` — the public pages (`app/page.tsx`, `login`,
 * `verify`, `not-found`, `oauth/consent`, `sso-callback`, …) and
 * `components/public/**` included. The public surface colours through its own
 * `--pub-*` tokens in `public-surface.css`; that CSS is not scanned (only
 * `.ts`/`.tsx` are), and its TSX was already clean when the scope grew.
 */
const ROOTS = ["app", "components"];
/** Files the first scope named one by one; still pinned so a move is noticed. */
const SINGLES = ["components/AccessDeniedModal.tsx", "components/ThemeToggle.tsx", "components/TenantBrandingProvider.tsx"];

/**
 * The ratchet: per-file count of findings not on the allow-list. A file may
 * only go down; a stale (too high) entry fails too, so the baseline follows
 * the sweep. Empty since P11-04 batch 5.
 */
const BASELINE: Record<string, number> = {};

const UTIL =
  "(?:bg|text|border|border-[trblxy]|ring|ring-offset|fill|stroke|from|via|to|outline|divide|decoration|shadow|placeholder|caret|accent)";
const PALETTE =
  "(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)";

const PATTERNS: Record<string, RegExp> = {
  hex: /(?<![\w&/-])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b/g,
  fn: /\b(?:rgba?|hsla?|oklch|oklab)\(/g,
  palette: new RegExp(`(?<![\\w-])${UTIL}-${PALETTE}-\\d{2,3}\\b`, "g"),
  wb: new RegExp(`(?<![\\w-])${UTIL}-(?:white|black)\\b`, "g"),
  arbitrary: /-\[(?:#|rgb|hsl|oklch|color:)/g,
  dark: new RegExp(`\\bdark:(?:[a-z-]+:)*${UTIL}-`, "g"),
  faded: /\btext-(?:[a-z]+-)?foreground\/\d+/g,
};

/**
 * `blend`: a gradient whose stops name two different hues — the copper→teal
 * `from-primary to-accent` the public error pages kept (ADR-122 §3: `accent`
 * is the verified teal, not a second brand colour). A gradient within ONE
 * token (`from-primary to-primary-hover`, `from-chart-2 to-chart-2`) or
 * fading into a neutral surface stays allowed: no token defines a two-hue
 * blend. Checked per line that names a gradient (`bg-linear-`, `bg-radial`,
 * `bg-conic`, `bg-gradient-`).
 */
const GRADIENT = /\bbg-(?:linear|radial|conic|gradient)\b/;
const STOP = /(?<![\w-])(?:from|via|to)-([a-z][a-z0-9-]*)/g;
const NEUTRAL_STOPS = new Set([
  "transparent",
  "current",
  "inherit",
  "background",
  "card",
  "popover",
  "muted",
  "foreground",
  "border",
  "sidebar",
  "secondary",
]);
const hueOf = (token: string): string => token.replace(/-(?:hover|pressed)$/, "");

const blends = (text: string): string[] => {
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!GRADIENT.test(line)) continue;
    const stops = [...line.matchAll(STOP)].map((m) => m[1]);
    const hues = [...new Set(stops.map(hueOf).filter((h) => !NEUTRAL_STOPS.has(h)))];
    if (hues.length > 1) out.push(hues.join("→"));
  }
  return out;
};

/** Every kind the scan reports; the fixture must exercise each. */
const KINDS = [...Object.keys(PATTERNS), "blend"];

interface Finding {
  kind: string;
  literal: string;
}

const scan = (text: string): Finding[] => {
  const out: Finding[] = [];
  for (const [kind, re] of Object.entries(PATTERNS)) {
    for (const m of text.matchAll(re)) out.push({ kind, literal: m[0] });
  }
  for (const literal of blends(text)) out.push({ kind: "blend", literal });
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

describe("P11-01 guard: app/** and components/** have no raw colour (ADR-122)", () => {
  const all = files();
  const findings = new Map<string, Finding[]>();
  for (const f of all) {
    const found = scan(fs.readFileSync(f, "utf8"));
    if (found.length) findings.set(rel(f), found);
  }

  it("scans all of app/** and components/**, the public surface included", () => {
    expect(all.length).toBeGreaterThan(350);
    const scanned = new Set(all.map(rel));
    for (const s of SINGLES) expect(scanned).toContain(s);
    for (const s of ["app/page.tsx", "app/not-found.tsx", "app/oauth/consent/page.tsx", "app/sso-callback/page.tsx", "app/login/page.tsx"]) {
      expect(scanned).toContain(s);
    }
    expect([...scanned].some((f) => f.startsWith("components/public/"))).toBe(true);
  });

  it("every exemption is still used exactly as reviewed (file, literal, count)", () => {
    for (const ex of COLOUR_EXEMPTIONS) {
      expect(ex.reason.length).toBeGreaterThan(10);
      const used = (findings.get(ex.file) ?? []).filter((f) => f.literal === ex.literal).length;
      expect({ ...ex, used }).toEqual({ ...ex, used: ex.count });
    }
  });

  it("no file has more raw colour than its baseline (zero outside the allow-list)", () => {
    const over: string[] = [];
    const stale: string[] = [];
    const seen = new Set<string>();
    for (const [file, list] of findings) {
      const exempt = new Set(COLOUR_EXEMPTIONS.filter((e) => e.file === file).map((e) => e.literal));
      const left = list.filter((f) => !exempt.has(f.literal));
      if (!left.length) continue;
      seen.add(file);
      const allowed = BASELINE[file] ?? 0;
      if (left.length > allowed) over.push(`${file}: ${left.map((f) => `${f.kind} ${f.literal}`).join(", ")}`);
      else if (left.length < allowed) stale.push(`${file}: ${left.length} < baseline ${allowed}`);
    }
    for (const [file, n] of Object.entries(BASELINE)) {
      if (!seen.has(file) && n > 0) stale.push(`${file}: 0 < baseline ${n}`);
    }
    expect(over).toEqual([]);
    expect(stale).toEqual([]);
  });
});

describe("P11-01 guard: each forbidden form is caught (fixture)", () => {
  const fixture = fs.readFileSync(path.join(__dirname, "fixtures/forbiddenColours.fixture.txt"), "utf8");
  const lines = fixture
    .split(/\r?\n/)
    .filter((l) => l.trim() && !l.startsWith("//"))
    .map((l) => {
      const [expect_, sample] = l.split(" | ");
      return { expected: expect_.trim(), sample: sample.trim() };
    });

  it("the fixture covers every pattern and some allowed forms", () => {
    const kinds = new Set(lines.map((l) => l.expected));
    for (const k of KINDS) expect(kinds).toContain(k);
    expect(kinds).toContain("ok");
  });

  it.each(lines.map((l) => [l.expected, l.sample]))("%s: %s", (expected, sample) => {
    const kinds = scan(sample).map((f) => f.kind);
    if (expected === "ok") expect(kinds).toEqual([]);
    else expect(kinds).toContain(expected);
  });
});
