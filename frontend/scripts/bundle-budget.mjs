#!/usr/bin/env node
/**
 * P10-13 (ADR-098 Amendment 2, doc 20 §13 AC-7): the public pages' first-load
 * JavaScript budget, read from a finished `next build`. Deterministic: the same
 * build gives the same numbers on any machine, unlike Lighthouse.
 *
 *   node scripts/bundle-budget.mjs            # check .next against bundle-budget.json
 *   node scripts/bundle-budget.mjs --dir <d>  # another build output (a copied .next)
 *   node scripts/bundle-budget.mjs --json     # machine-readable report
 *
 * First-load JavaScript of a route = the root main files every page loads
 * (react-dom, the Next runtime, the Turbopack runtime; `build-manifest.json`
 * `rootMainFiles`) ∪ every chunk the route's client-reference manifest lists
 * under `entryJSFiles` (its layouts, the page, and the error / not-found /
 * global-error boundaries, which load with the page). `polyfillFiles` are
 * excluded: they are `nomodule` and a current browser never fetches them.
 * Chunks a client component loads later with `import()` are not first-load
 * and are not counted.
 *
 * P10-18 (ADR-131): the same report also counts each route's first-load CSS —
 * every stylesheet the manifest lists under `entryCSSFiles` (its root layout's
 * global sheet, the page's own, the font faces), all render-blocking — and a
 * route whose budget sets `cssGzipKB` fails over it. A route under a route
 * group (`app/(public)/login`) is found by its URL: the group folder is not a
 * path segment, so the manifest is looked up under each `(group)` folder too.
 *
 * Each file is compressed here, per file, as a server would send it:
 * brotli quality 11 (a precompressed or CDN-compressed asset) and gzip level 6
 * (Node's and most servers' default). The budget file sets a ceiling for each.
 * Exit code 1 when any route is over; 2 when the build output is missing.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const frontend = path.resolve(here, "..");

const args = process.argv.slice(2);
const argValue = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const distDir = path.resolve(argValue("--dir") ?? path.join(frontend, ".next"));
const budgetFile = path.resolve(argValue("--budget") ?? path.join(frontend, "bundle-budget.json"));
const asJson = args.includes("--json");

const KB = 1024;
const fmt = (bytes) => `${(bytes / KB).toFixed(1)} KB`;

/** @param {string} file */
const readManifest = (file) => {
  const sandbox = { globalThis: { __RSC_MANIFEST: {} } };
  // The manifest is a script that assigns one entry on globalThis.__RSC_MANIFEST.
  const code = fs.readFileSync(file, "utf8");
  new Function("globalThis", code)(sandbox.globalThis);
  const entries = Object.values(sandbox.globalThis.__RSC_MANIFEST);
  if (entries.length !== 1) throw new Error(`${file}: expected one manifest entry, found ${entries.length}`);
  return /** @type {{ entryJSFiles: Record<string, string[]>, entryCSSFiles?: Record<string, Array<{ path: string, inlined?: boolean }>> }} */ (
    entries[0]
  );
};

/**
 * "/" → server/app/page_client-reference-manifest.js; "/verify/[n]" → server/app/verify/[n]/page_…;
 * under a route group (ADR-131) → server/app/(public)/verify/[n]/page_… — the first that exists.
 */
const manifestFor = (route) => {
  const segments = route.split("/").filter(Boolean);
  const appDir = path.join(distDir, "server", "app");
  const direct = path.join(appDir, ...segments, "page_client-reference-manifest.js");
  if (fs.existsSync(direct)) return direct;
  const groups = fs.existsSync(appDir)
    ? fs.readdirSync(appDir).filter((d) => /^\(.+\)$/.test(d)).sort()
    : [];
  for (const group of groups) {
    const grouped = path.join(appDir, group, ...segments, "page_client-reference-manifest.js");
    if (fs.existsSync(grouped)) return grouped;
  }
  return direct;
};

const sizeCache = new Map();
/** @param {string} rel a path relative to the build output, e.g. static/chunks/x.js */
const sizes = (rel) => {
  const cached = sizeCache.get(rel);
  if (cached) return cached;
  const buf = fs.readFileSync(path.join(distDir, rel));
  const s = {
    raw: buf.length,
    gzip: zlib.gzipSync(buf, { level: 6 }).length,
    brotli: zlib.brotliCompressSync(buf, {
      params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buf.length },
    }).length,
  };
  sizeCache.set(rel, s);
  return s;
};

const main = () => {
  const buildManifestPath = path.join(distDir, "build-manifest.json");
  if (!fs.existsSync(buildManifestPath)) {
    console.error(`bundle-budget: no build at ${distDir} (run \`next build\` first)`);
    return 2;
  }
  /** @type {{ rootMainFiles: string[] }} */
  const buildManifest = JSON.parse(fs.readFileSync(buildManifestPath, "utf8"));
  /** @type {{ routes: Record<string, { brotliKB: number, gzipKB: number, cssGzipKB?: number, note?: string }> }} */
  const budget = JSON.parse(fs.readFileSync(budgetFile, "utf8"));

  const report = [];
  let failed = false;
  for (const [route, limit] of Object.entries(budget.routes)) {
    const manifestPath = manifestFor(route);
    if (!fs.existsSync(manifestPath)) {
      report.push({ route, error: `no client-reference manifest at ${path.relative(distDir, manifestPath)}` });
      failed = true;
      continue;
    }
    const manifest = readManifest(manifestPath);
    const files = new Set(buildManifest.rootMainFiles);
    for (const chunks of Object.values(manifest.entryJSFiles)) for (const c of chunks) files.add(c);
    const total = { raw: 0, gzip: 0, brotli: 0 };
    const perFile = [];
    for (const f of files) {
      const s = sizes(f);
      total.raw += s.raw;
      total.gzip += s.gzip;
      total.brotli += s.brotli;
      perFile.push({ file: f, ...s, root: buildManifest.rootMainFiles.includes(f) });
    }
    const overBrotli = total.brotli > limit.brotliKB * KB;
    const overGzip = total.gzip > limit.gzipKB * KB;

    // First-load CSS: every stylesheet any entry of the route lists, once each.
    const cssFiles = new Set();
    for (const sheets of Object.values(manifest.entryCSSFiles ?? {})) {
      for (const sheet of sheets) if (!sheet.inlined) cssFiles.add(sheet.path);
    }
    const css = { raw: 0, gzip: 0, brotli: 0 };
    const cssPerFile = [];
    for (const f of cssFiles) {
      const s = sizes(f);
      css.raw += s.raw;
      css.gzip += s.gzip;
      css.brotli += s.brotli;
      cssPerFile.push({ file: f, ...s });
    }
    const overCss = limit.cssGzipKB !== undefined && css.gzip > limit.cssGzipKB * KB;

    if (overBrotli || overGzip || overCss) failed = true;
    report.push({ route, total, limit, overBrotli, overGzip, overCss, files: perFile, css, cssFiles: cssPerFile });
  }

  if (asJson) {
    console.log(JSON.stringify({ distDir, report }, null, 2));
  } else {
    const rootTotal = buildManifest.rootMainFiles.reduce(
      (acc, f) => ({ gzip: acc.gzip + sizes(f).gzip, brotli: acc.brotli + sizes(f).brotli }),
      { gzip: 0, brotli: 0 },
    );
    console.log(`bundle-budget: ${distDir}`);
    console.log(`  framework (rootMainFiles, every page): brotli ${fmt(rootTotal.brotli)} · gzip ${fmt(rootTotal.gzip)}`);
    for (const r of report) {
      if (r.error) {
        console.log(`  ✗ ${r.route}: ${r.error}`);
        continue;
      }
      const mark = r.overBrotli || r.overGzip || r.overCss ? "✗" : "✓";
      console.log(
        `  ${mark} ${r.route.padEnd(28)} brotli ${fmt(r.total.brotli).padStart(9)} / ${r.limit.brotliKB} KB` +
          `   gzip ${fmt(r.total.gzip).padStart(9)} / ${r.limit.gzipKB} KB   (${r.files.length} files)` +
          `   css gzip ${fmt(r.css.gzip).padStart(8)}` +
          (r.limit.cssGzipKB !== undefined ? ` / ${r.limit.cssGzipKB} KB` : "") +
          ` (raw ${fmt(r.css.raw)}, ${r.cssFiles.length} files)`,
      );
      if (r.overCss) {
        for (const f of [...r.cssFiles].sort((a, b) => b.gzip - a.gzip)) {
          console.log(`      ${f.file}  css raw ${fmt(f.raw)}  gzip ${fmt(f.gzip)}`);
        }
      }
      if (r.overBrotli || r.overGzip) {
        for (const f of r.files.filter((x) => !x.root).sort((a, b) => b.brotli - a.brotli)) {
          console.log(`      ${f.file}  brotli ${fmt(f.brotli)}  gzip ${fmt(f.gzip)}`);
        }
      }
    }
  }
  return failed ? 1 : 0;
};

process.exitCode = main();
