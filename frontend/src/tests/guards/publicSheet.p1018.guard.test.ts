/**
 * P10-18 (ADR-131): the public surface's own global sheet, app/public.css.
 *
 * Its Tailwind build scans ONLY the paths its `@source` lines name
 * (`source(none)`), so a component a public page renders from anywhere else
 * gets no utilities — in production only, where nobody looks (ADR-131,
 * "Implications"). This guard walks the import graph of every public document
 * (app/(public)/** and app/global-not-found.tsx) and fails on any reachable
 * file that writes a class list outside those paths. It also holds:
 *
 *  - the two sheets apart: globals.css no longer carries the public tokens,
 *    and nothing on the public graph imports the dashboard sheet;
 *  - both sheets on the same three shared partials (motion tokens, article
 *    prose, reduced motion), so they cannot drift;
 *  - the public canvas colours equal to the surface's own background tokens.
 *
 * Fail-before: on the single-root tree public.css did not exist and every
 * public page loaded globals.css.
 */
import fs from "node:fs";
import path from "node:path";

const SRC = path.resolve(__dirname, "../..");
const APP = path.join(SRC, "app");
const css = (rel: string) => fs.readFileSync(path.join(APP, rel), "utf8");
const publicCss = css("public.css");
const globalsCss = css("globals.css");

/** The `@source` paths of public.css, absolute. */
const SOURCES = [...publicCss.matchAll(/^@source "([^"]+)";$/gm)].map((m) => path.resolve(APP, m[1]));

const EXTS = [".tsx", ".ts", ".css"];
const resolveImport = (from: string, spec: string): string | null => {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
  else return null;
  if (fs.existsSync(base) && fs.statSync(base).isFile()) return base;
  for (const e of EXTS) if (fs.existsSync(base + e)) return base + e;
  for (const e of EXTS) if (fs.existsSync(path.join(base, `index${e}`))) return path.join(base, `index${e}`);
  return null;
};

const isTest = (f: string) => /__tests__|\.test\./.test(f);
const walkDir = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walkDir(p);
    return /\.(tsx?|css)$/.test(e.name) ? [p] : [];
  });

/** Every non-test source file reachable from the public documents (static and dynamic imports). */
const publicGraph = (): string[] => {
  const seen = new Set<string>();
  const queue = [...walkDir(path.join(APP, "(public)")), path.join(APP, "global-not-found.tsx")].filter((f) => !isTest(f));
  for (const f of queue) seen.add(f);
  while (queue.length) {
    const file = queue.shift() as string;
    const code = fs.readFileSync(file, "utf8");
    const specs = [
      ...code.matchAll(/^\s*import\s+(?!type\b)(?:[^"';]*?\s+from\s+)?["']([^"']+)["']/gm),
      ...code.matchAll(/^\s*export\s+(?!type\b)[^"';]*?\s+from\s+["']([^"']+)["']/gm),
      ...code.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g),
      ...code.matchAll(/@import\s+["']([^"']+)["']/g),
    ].map((m) => m[1]);
    for (const spec of specs) {
      const target = resolveImport(file, spec);
      if (target && !isTest(target) && !seen.has(target)) {
        seen.add(target);
        queue.push(target);
      }
    }
  }
  return [...seen];
};

const rel = (f: string) => path.relative(SRC, f).split(path.sep).join("/");
const covered = (f: string) => SOURCES.some((s) => f === s || f.startsWith(s + path.sep));

describe("ADR-131: the public sheet (app/public.css)", () => {
  const graph = publicGraph();

  it("walks a real graph (the landing, the sign-in forms, the verification page, blog and news)", () => {
    const names = graph.map(rel);
    for (const f of [
      "app/(public)/page.tsx",
      "app/(public)/login/components/LoginPanel.tsx",
      "components/public/AuthShell.tsx",
      "components/blog/ArticleBody.tsx",
      "app/(public)/verify/[certificateNumber]/VerifyContent.tsx",
      "app/public.css",
    ]) {
      expect([f, names.includes(f)]).toEqual([f, true]);
    }
  });

  it("builds Tailwind from the listed public sources only", () => {
    expect(publicCss).toMatch(/^@import "tailwindcss" source\(none\);$/m);
    expect(SOURCES.length).toBeGreaterThan(3);
    for (const s of SOURCES) expect([rel(s), fs.existsSync(s)]).toEqual([rel(s), true]);
  });

  it("every file a public page renders that writes a class list lies under an @source path", () => {
    const outside = graph
      .filter((f) => f.endsWith(".tsx"))
      .filter((f) => /\bclassName=/.test(fs.readFileSync(f, "utf8")))
      .filter((f) => !covered(f))
      .map(rel);
    expect(outside).toEqual([]);
  });

  it("nothing on the public graph imports the dashboard sheet", () => {
    expect(graph.map(rel).filter((f) => f === "app/globals.css")).toEqual([]);
  });

  it("the dashboard sheet no longer carries the public tokens; both sheets share the same three partials", () => {
    expect(globalsCss).not.toMatch(/@import\s+["'][^"']*public-surface\.css/);
    expect(globalsCss).not.toMatch(/--pub-bg:/);
    expect(publicCss).toMatch(/^@import "\.\/public-surface\.css";$/m);
    for (const partial of ["./styles/motion-tokens.css", "./styles/article-prose.css", "./styles/reduced-motion.css"]) {
      expect([partial, publicCss.includes(`@import "${partial}";`), globalsCss.includes(`@import "${partial}";`)]).toEqual([
        partial,
        true,
        true,
      ]);
    }
  });

  it("the public canvas behind the surface is the surface's own background, in both themes", () => {
    const surface = css("public-surface.css");
    const token = (name: string) => surface.match(new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{6});`))?.[1]?.toLowerCase();
    const light = publicCss.match(/^html \{[^}]*background-color:\s*(#[0-9a-f]{6});/m)?.[1];
    const dark = publicCss.match(/^html\.dark \{[^}]*background-color:\s*(#[0-9a-f]{6});/m)?.[1];
    const darkNoChoice = publicCss.match(/html:not\(\[data-theme-choice\]\) \{[^}]*background-color:\s*(#[0-9a-f]{6});/)?.[1];
    expect({ light, dark, darkNoChoice }).toEqual({
      light: token("--pub-bg"),
      dark: token("--pub-dark-bg"),
      darkNoChoice: token("--pub-dark-bg"),
    });
  });
});
