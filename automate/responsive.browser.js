#!/usr/bin/env node
/**
 * Public-page layout check (P10-13 AC-4; WCAG 1.4.4 Resize Text, 1.4.10 Reflow).
 * The sibling of automate/a11y.browser.js, whose "reflow" check covers sideways
 * scroll at 200 % zoom; this one adds what that cannot see.
 *
 * For every public page state, in five modes —
 *   375, 1024, 1440   viewport width (CSS px), 900 high;
 *   zoom200           browser zoom 200 % at a 1280 window (640 CSS px at DSF 2);
 *   text200           TEXT-ONLY zoom: the browser's default font size 16 -> 32 px
 *                     (CDP Page.setFontSizes), 1280 wide — rem and em media queries scale —
 * it fails on:
 *   - horizontal scroll (documentElement.scrollWidth > clientWidth);
 *   - clipped text: a visible text box extending past an ancestor that hides overflow,
 *     an element clipping its own text, or text-overflow: ellipsis in effect;
 *   - overlapping text: two visible text boxes (their text ranges) intersecting, neither
 *     containing the other — the body of a closed <details> is not rendered and not counted;
 *   - not exactly one <main> and one <h1>, or no lang on <html>.
 *
 * Environment: FRONTEND_URL (default http://localhost:3001), CHROME_PATH,
 * RESPONSIVE_SHOTS=<dir> to also write full-page WebP captures, RESPONSIVE_MODES
 * (comma list, default all five), RESPONSIVE_EXPECT_CLOSED=1 when the stack has no
 * PRIVACY_NOTICE_URL (ADR-113: /request-access is then the "not open yet" state).
 * RESPONSIVE_SELFTEST=1 plants a clipped line and two overlapping lines on every page
 * and passes only if every page-mode pair reports them (the check proves it can fail).
 * RESPONSIVE_PATHS="name=/path,…" replaces the page list (e.g. a valid verification
 * link: "verify-valid=/verify/CERT-DEMO-0003?t=<token>").
 * Exit 1 on any finding.
 */
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-core");

const origin = (process.env.FRONTEND_URL ?? "http://localhost:3001").replace(/\/$/, "");
const out = process.env.RESPONSIVE_SHOTS ?? "";
const PAGES = process.env.RESPONSIVE_PATHS
  ? process.env.RESPONSIVE_PATHS.split(",").map((pair) => [pair.slice(0, pair.indexOf("=")).trim(), pair.slice(pair.indexOf("=") + 1).trim()])
  : [
  ["landing", "/"],
  ["login", "/login"],
  [process.env.RESPONSIVE_EXPECT_CLOSED ? "request-access-closed" : "request-access", "/request-access"],
  ["forgot-password", "/forgot-password"],
  ["invitation", "/invitation"],
  ["blog", "/blog"],
  ["news", "/news"],
  ["verify", "/verify"],
  ["verify-not-found", "/verify/CERT-NOPE-1"],
];
/** RESPONSIVE_SELFTEST=1: plant a defect on every page; the run passes only if EVERY pair reports it. */
const SELFTEST = process.env.RESPONSIVE_SELFTEST === "1";
const MODES = (process.env.RESPONSIVE_MODES ?? "w375,w1024,w1440,zoom200,text200").split(",");

function chromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter((p) => typeof p === "string" && p !== "");
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) throw new Error(`No Chrome/Chromium found; set CHROME_PATH (tried: ${candidates.join(", ")})`);
  return found;
}

const audit = () => {
  const de = document.documentElement;
  const visible = (el) => {
    if (el.closest('[aria-hidden="true"], .sr-only, [hidden]')) return false;
    // The body of a closed <details> is not rendered (only its <summary> is).
    const d = el.closest("details");
    if (d && !d.open && !el.closest("summary")) return false;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  };
  const label = (el) => `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${typeof el.className === "string" && el.className ? "." + el.className.trim().split(/\s+/).slice(0, 3).join(".") : ""} "${(el.textContent ?? "").trim().slice(0, 40)}"`;
  // Text boxes: elements with a direct non-blank text node.
  const textEls = [...document.querySelectorAll("body *")].filter(
    (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim() !== "") && visible(el),
  );
  // Clipped: the element itself, or an ancestor, hides overflow its content needs.
  const clipped = [];
  for (const el of textEls) {
    for (let a = el; a && a !== document.body; a = a.parentElement) {
      const cs = getComputedStyle(a);
      const hidesX = /hidden|clip/.test(cs.overflowX);
      const hidesY = /hidden|clip/.test(cs.overflowY);
      // A container that hides overflow clips THIS text only if the text's own box extends past it
      // (a wider decorative glow inside the same section is not text being clipped).
      const er = el.getBoundingClientRect();
      const ar = a.getBoundingClientRect();
      const outside = (hidesX && (er.right > ar.right + 1 || er.left < ar.left - 1)) || (hidesY && (er.bottom > ar.bottom + 1 || er.top < ar.top - 1));
      const ellipsis = cs.textOverflow === "ellipsis" && a.scrollWidth > a.clientWidth + 1;
      const selfClip = a === el && ((hidesX && a.scrollWidth > a.clientWidth + 1) || (hidesY && a.scrollHeight > a.clientHeight + 1));
      if (outside || ellipsis || selfClip) {
        clipped.push(`${label(el)} in ${label(a)} (${a.scrollWidth}x${a.scrollHeight} > ${a.clientWidth}x${a.clientHeight})`);
        break;
      }
    }
  }
  // Overlap: two text boxes (Range rects of their own text) intersecting, neither containing the other.
  const boxes = textEls.map((el) => {
    const range = document.createRange();
    const rects = [];
    for (const n of el.childNodes) {
      if (n.nodeType === 3 && n.textContent.trim() !== "") {
        range.selectNodeContents(n);
        rects.push(...[...range.getClientRects()].filter((r) => r.width > 1 && r.height > 1));
      }
    }
    return { el, rects };
  });
  const overlaps = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const A = boxes[i], B = boxes[j];
      if (A.el.contains(B.el) || B.el.contains(A.el)) continue;
      const hit = A.rects.some((a) => B.rects.some((b) => {
        const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        return w > 2 && h > 2;
      }));
      if (hit) overlaps.push(`${label(A.el)} x ${label(B.el)}`);
    }
  }
  const wide = [...document.querySelectorAll("body *")]
    .filter((el) => visible(el) && el.getBoundingClientRect().right > de.clientWidth + 1)
    .slice(0, 5)
    .map(label);
  return {
    scrollWidth: de.scrollWidth,
    clientWidth: de.clientWidth,
    rootFontPx: getComputedStyle(de).fontSize,
    main: document.querySelectorAll("main").length,
    h1: document.querySelectorAll("h1").length,
    lang: de.lang,
    clipped: clipped.slice(0, 10),
    overlaps: overlaps.slice(0, 10),
    wide,
  };
};

(async () => {
  if (out) fs.mkdirSync(out, { recursive: true });
  const sharp = out ? require("sharp") : null;
  const browser = await puppeteer.launch({ executablePath: chromePath(), headless: true, args: ["--no-sandbox", "--hide-scrollbars"] });
  const rows = [];
  try {
    for (const [name, route] of PAGES) {
      for (const mode of MODES) {
        const page = await browser.newPage();
        const cdp = await page.createCDPSession();
        if (mode === "zoom200") await page.setViewport({ width: 640, height: 450, deviceScaleFactor: 2 });
        else if (mode === "text200") {
          await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
          await cdp.send("Page.enable");
          await cdp.send("Page.setFontSizes", { fontSizes: { standard: 32, fixed: 26 } });
        } else await page.setViewport({ width: Number(mode.slice(1)), height: 900, deviceScaleFactor: 1 });
        await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
        const res = await page.goto(origin + route, { waitUntil: "networkidle0", timeout: 60000 });
        await page.evaluate(() => document.fonts.ready);
        await page.evaluate(async () => {
          for (let y = 0; y < document.documentElement.scrollHeight; y += 400) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 80)); }
          window.scrollTo(0, 0);
        });
        await page.evaluate(() => Promise.race([
          Promise.all([...document.images].filter((i) => i.getBoundingClientRect().height > 0).map((i) => { i.loading = "eager"; return i.decode().catch(() => null); })),
          new Promise((r) => setTimeout(r, 10000)),
        ]));
        await new Promise((r) => setTimeout(r, 300));
        if (SELFTEST) {
          // Plant one clipped line and two overlapping lines: the audit must report both.
          await page.evaluate(() => {
            const host = document.querySelector("main") ?? document.body;
            const box = document.createElement("div");
            box.style.cssText = "width:60px;overflow:hidden;white-space:nowrap";
            box.textContent = "This sentence is far too long for its sixty pixel box";
            const wrap = document.createElement("div");
            wrap.style.cssText = "position:relative;height:40px";
            wrap.innerHTML = '<span style="position:absolute;left:0;top:0">First overlapping line</span><span style="position:absolute;left:10px;top:4px">Second overlapping line</span>';
            host.prepend(box, wrap);
          });
        }
        const m = await page.evaluate(audit);
        let file = null;
        if (out) {
          // Full-page capture: viewport-sized bands, scrolled and stitched. NOT puppeteer's fullPage
          // (it resets the font-size emulation: root 32px -> 16px, measured), and NOT a viewport as tall as
          // the page (100vh would then equal the page height and push the footer off the capture).
          const vw = mode === "zoom200" ? 640 : mode === "text200" ? 1280 : Number(mode.slice(1));
          const vh = mode === "zoom200" ? 450 : 900;
          const dsf = mode === "zoom200" ? 2 : 1;
          await page.evaluate(() => {
            for (const el of document.querySelectorAll("body *")) {
              const pos = getComputedStyle(el).position;
              if (pos === "sticky" || pos === "fixed") el.style.position = "relative";
            }
          });
          const H = await page.evaluate(() => document.documentElement.scrollHeight);
          const parts = [];
          for (let y = 0; y < H; y += vh) {
            const top = Math.min(y, Math.max(0, H - vh));
            await page.evaluate((t) => window.scrollTo(0, t), top);
            await new Promise((r) => setTimeout(r, 120));
            const shot = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
            parts.push({ input: Buffer.from(shot.data, "base64"), top: top * dsf, left: 0 });
          }
          const stillZoomed = await page.evaluate(() => getComputedStyle(document.documentElement).fontSize);
          if (mode === "text200" && stillZoomed !== "32px") throw new Error(`text200 lost its font size during the capture (${stillZoomed})`);
          const png = await sharp({ create: { width: vw * dsf, height: H * dsf, channels: 4, background: "#000" } }).composite(parts).png().toBuffer();
          file = `ac4-${name}-${mode.replace(/^w/, "")}.webp`;
          const meta = await sharp(png).metadata();
          const img = (meta.height ?? 0) > 16000 ? sharp(png).resize({ height: 16000 }) : sharp(png);
          await img.webp({ quality: 70 }).toFile(path.join(out, file));
        }
        rows.push({ page: route, mode, status: res ? res.status() : null, file, ...m, overflow: m.scrollWidth > m.clientWidth });
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
  let failed = 0;
  for (const r of rows) {
    // text200 must actually have doubled the root size, or the pair proves nothing.
    const notZoomed = r.mode === "text200" && r.rootFontPx !== "32px";
    const found = r.clipped.length > 0 || r.overlaps.length > 0;
    const bad = SELFTEST ? !found || notZoomed : r.overflow || found || r.main !== 1 || r.h1 !== 1 || !r.lang || r.status !== 200 || notZoomed;
    if (bad) failed++;
    console.log(`${bad ? "FAIL" : "ok  "} ${r.mode}	${r.page}	scroll ${r.scrollWidth}/${r.clientWidth} root=${r.rootFontPx} main=${r.main} h1=${r.h1} lang=${r.lang} clipped=${r.clipped.length} overlaps=${r.overlaps.length}`);
    for (const c of r.clipped) console.log("     CLIP " + c);
    for (const o of r.overlaps) console.log("     OVERLAP " + o);
    if (r.overflow) for (const w of r.wide) console.log("     WIDE " + w);
  }
  console.log(SELFTEST ? `${rows.length - failed}/${rows.length} pairs detected the planted defect` : `${rows.length - failed}/${rows.length} page-mode pairs clean`);
  if (failed > 0) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
