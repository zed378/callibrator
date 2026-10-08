/**
 * P10-13 (ADR-098 Amendment 2, doc 20 §13 AC-7): scripts/bundle-budget.mjs —
 * the CI check that keeps the public pages' first-load JavaScript under its
 * ceilings. Run against a synthetic build output, so it proves the CHECK (what
 * it counts, what it fails on), not any particular build:
 *
 *  - it counts the root main files plus every chunk the route's
 *    client-reference manifest lists (layouts, page, boundaries), once each;
 *  - it ignores the nomodule polyfills;
 *  - over a ceiling → exit 1 and the offending route named; under → exit 0;
 *  - no build → exit 2.
 *
 * P10-18 (ADR-131): a route under a route group is found by its URL, and the
 * first-load CSS (entryCSSFiles) is counted and held to `cssGzipKB`.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { spawnSync } from "node:child_process";

const script = path.resolve(__dirname, "../../../scripts/bundle-budget.mjs");

/** Pseudo-random bytes compress poorly, so the compressed size is close to the raw size. */
const noise = (bytes: number, seed: number) => {
  let x = seed;
  let out = "";
  while (out.length < bytes) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    out += x.toString(36);
  }
  return `/*${out.slice(0, bytes)}*/`;
};

let dir: string;

const write = (rel: string, content: string) => {
  const abs = path.join(dir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
};

const manifest = (
  route: string,
  entries: Record<string, string[]>,
  css: Record<string, Array<{ path: string; inlined: boolean }>> = {},
) =>
  `globalThis.__RSC_MANIFEST = globalThis.__RSC_MANIFEST || {};\nglobalThis.__RSC_MANIFEST[${JSON.stringify(route)}] = ${JSON.stringify({
    clientModules: {},
    entryJSFiles: entries,
    entryCSSFiles: css,
  })};`;

const brotli = (rel: string) =>
  zlib.brotliCompressSync(fs.readFileSync(path.join(dir, rel)), {
    params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11 },
  }).length;

const run = (budget: object) => {
  write("budget.json", JSON.stringify(budget));
  return spawnSync(process.execPath, [script, "--dir", dir, "--budget", path.join(dir, "budget.json")], {
    encoding: "utf8",
  });
};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "bundle-budget-"));
  write("build-manifest.json", JSON.stringify({ rootMainFiles: ["static/chunks/root.js"], polyfillFiles: ["static/chunks/poly.js"] }));
  write("static/chunks/root.js", noise(20_000, 1));
  write("static/chunks/poly.js", noise(50_000, 2));
  write("static/chunks/layout.js", noise(4_000, 3));
  write("static/chunks/page.js", noise(8_000, 4));
  write(
    "server/app/verify/[n]/page_client-reference-manifest.js",
    manifest("/verify/[n]/page", {
      "[project]/src/app/layout": ["static/chunks/layout.js"],
      "[project]/src/app/verify/[n]/page": ["static/chunks/layout.js", "static/chunks/page.js"],
    }),
  );
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("P10-13: the first-load JavaScript budget check", () => {
  it("counts the root files and each listed chunk once, never the polyfills, and passes under the ceiling", () => {
    const expected = brotli("static/chunks/root.js") + brotli("static/chunks/layout.js") + brotli("static/chunks/page.js");
    const res = run({ routes: { "/verify/[n]": { brotliKB: 100, gzipKB: 100 } } });

    expect(res.status).toBe(0);
    const json = spawnSync(process.execPath, [script, "--dir", dir, "--budget", path.join(dir, "budget.json"), "--json"], {
      encoding: "utf8",
    });
    const report = JSON.parse(json.stdout).report[0];
    expect(report.files.map((f: { file: string }) => f.file).sort()).toEqual([
      "static/chunks/layout.js",
      "static/chunks/page.js",
      "static/chunks/root.js",
    ]);
    // Per-file compression, as a server sends each file (±1 byte of the params' size hint).
    expect(Math.abs(report.total.brotli - expected)).toBeLessThanOrEqual(3);
  });

  it("fails, naming the route, when a route is over its ceiling", () => {
    const res = run({ routes: { "/verify/[n]": { brotliKB: 20, gzipKB: 100 } } });

    expect(res.status).toBe(1);
    expect(res.stdout).toMatch(/✗ \/verify\/\[n\]/);
    expect(res.stdout).toContain("static/chunks/page.js");
  });

  it("fails on the gzip ceiling too", () => {
    const res = run({ routes: { "/verify/[n]": { brotliKB: 100, gzipKB: 20 } } });
    expect(res.status).toBe(1);
  });

  it("fails when a budgeted route has no manifest (a renamed route cannot silently drop out)", () => {
    const res = run({ routes: { "/gone": { brotliKB: 100, gzipKB: 100 } } });
    expect(res.status).toBe(1);
    expect(res.stdout).toMatch(/✗ \/gone: no client-reference manifest/);
  });

  it("exits 2 with no build", () => {
    fs.rmSync(path.join(dir, "build-manifest.json"));
    const res = run({ routes: {} });
    expect(res.status).toBe(2);
  });

  describe("P10-18 (ADR-131): route groups and first-load CSS", () => {
    beforeEach(() => {
      write("static/chunks/public.css", noise(6_000, 5));
      write("static/chunks/fonts.css", noise(1_000, 6));
      write(
        "server/app/(public)/login/page_client-reference-manifest.js",
        manifest(
          "/(public)/login/page",
          {
            "[project]/src/app/(public)/layout": ["static/chunks/layout.js"],
            "[project]/src/app/(public)/login/page": ["static/chunks/page.js"],
          },
          {
            "[project]/src/app/(public)/layout": [
              { path: "static/chunks/public.css", inlined: false },
              { path: "static/chunks/fonts.css", inlined: false },
            ],
            "[project]/src/app/(public)/login/page": [{ path: "static/chunks/public.css", inlined: false }],
          },
        ),
      );
    });

    const report = (budget: object) => {
      write("budget.json", JSON.stringify(budget));
      const res = spawnSync(process.execPath, [script, "--dir", dir, "--budget", path.join(dir, "budget.json"), "--json"], {
        encoding: "utf8",
      });
      return JSON.parse(res.stdout).report[0];
    };

    it("finds a route under a (group) folder by its URL", () => {
      const r = report({ routes: { "/login": { brotliKB: 100, gzipKB: 100 } } });
      expect(r.error).toBeUndefined();
      expect(r.files.map((f: { file: string }) => f.file).sort()).toEqual([
        "static/chunks/layout.js",
        "static/chunks/page.js",
        "static/chunks/root.js",
      ]);
    });

    it("counts each listed stylesheet once and passes under the CSS ceiling", () => {
      const r = report({ routes: { "/login": { brotliKB: 100, gzipKB: 100, cssGzipKB: 100 } } });
      expect(r.cssFiles.map((f: { file: string }) => f.file).sort()).toEqual(["static/chunks/fonts.css", "static/chunks/public.css"]);
      expect(r.css.raw).toBe(
        fs.statSync(path.join(dir, "static/chunks/public.css")).size + fs.statSync(path.join(dir, "static/chunks/fonts.css")).size,
      );
      expect(r.overCss).toBe(false);
      expect(run({ routes: { "/login": { brotliKB: 100, gzipKB: 100, cssGzipKB: 100 } } }).status).toBe(0);
    });

    it("fails, listing the sheets, when the route's CSS is over its ceiling", () => {
      const res = run({ routes: { "/login": { brotliKB: 100, gzipKB: 100, cssGzipKB: 2 } } });
      expect(res.status).toBe(1);
      expect(res.stdout).toMatch(/✗ \/login/);
      expect(res.stdout).toContain("static/chunks/public.css");
    });

    it("a route with no CSS ceiling reports its CSS and does not fail on it", () => {
      const r = report({ routes: { "/login": { brotliKB: 100, gzipKB: 100 } } });
      expect(r.css.gzip).toBeGreaterThan(0);
      expect(r.overCss).toBe(false);
    });
  });

  it("the committed budget holds doc 20's AC-7 figures", () => {
    const committed = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../bundle-budget.json"), "utf8"));
    expect(committed.routes["/"].brotliKB).toBeLessThanOrEqual(180);
    expect(committed.routes["/verify/[certificateNumber]"].brotliKB).toBeLessThanOrEqual(120);
    // P10-18 (ADR-131 decision 6): the landing and the sign-in page carry a CSS ceiling.
    expect(committed.routes["/"].cssGzipKB).toEqual(expect.any(Number));
    expect(committed.routes["/login"].cssGzipKB).toEqual(expect.any(Number));
  });
});
