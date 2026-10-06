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
 *
 * The verification demo (landing #verifikasi; P10-17 fix, 2026-10-06): when the page
 * list includes "/", a second sweep loads the landing in ID and EN, light and dark,
 * with reduced motion (plus two passes without it), at every width in
 * RESPONSIVE_QR_WIDTHS (default 360 ... 1536, 15 widths), in the idle AND the verified
 * state, and fails on:
 *   - the paper certificate and the phone intersecting;
 *   - anything inside the certificate (number, sample tag, QR, button) extending past
 *     it, or the certificate or the phone extending past the viewport;
 *   - the QR not fully visible: elementFromPoint at its four corners and centre must
 *     hit the QR itself, not the phone or anything else;
 *   - the certificate number breaking mid-token: every line but the last must end in
 *     "-" (on the certificate and in the phone's verdict);
 *   - the button's or the sample tag's text on more than one line;
 *   - the verdict extending past the phone's screen, or an empty live region;
 *   - the certificate or the phone changing size between idle and verified (layout shift);
 *   - without reduced motion, a verdict that appears at once (no scan).
 * RESPONSIVE_QR=0 skips it; RESPONSIVE_QR_ONLY=1 runs only it. RESPONSIVE_QR_SHOTS=<dir>
 * writes WebP crops of the demo (verified state, EN, reduced motion) at 768/773/820/1024
 * in both themes, named p1017-fix-qr-<RESPONSIVE_QR_SHOT_TAG, default "after">-<theme>-<width>.webp.
 * Under RESPONSIVE_SELFTEST=1 it plants an overlap, a squeezed number and a squeezed
 * button, and passes only if every row reports all three.
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
const QR_ON = process.env.RESPONSIVE_QR !== "0" && PAGES.some(([, route]) => route === "/");
const QR_ONLY = process.env.RESPONSIVE_QR_ONLY === "1";
const QR_WIDTHS = (process.env.RESPONSIVE_QR_WIDTHS ?? "360,390,480,600,640,700,768,773,820,900,960,1024,1100,1280,1536").split(",").map(Number);
const QR_SHOTS = process.env.RESPONSIVE_QR_SHOTS ?? "";
const QR_SHOT_TAG = process.env.RESPONSIVE_QR_SHOT_TAG ?? "after";
const QR_SHOT_WIDTHS = [768, 773, 820, 1024];
/** [locale, theme, reduced motion]: every locale and theme with reduced motion, and two passes without it. */
const QR_PASSES = [
  ["id", "light", true], ["id", "dark", true], ["en", "light", true], ["en", "dark", true],
  ["en", "light", false], ["id", "dark", false],
];

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

/** The verification demo's geometry, in the page (see the header). Returns findings. */
const qrAudit = (state) => {
  const found = [];
  const q = (s) => document.querySelector(s);
  const cert = q("#verifikasi .lp-cert");
  const phone = q("#verifikasi .lp-phone");
  const qr = q("#verifikasi .lp-cert svg.lp-qr");
  const button = q("#verifikasi .lp-cert button");
  const tag = q("#verifikasi .lp-cert .lp-sample-tag");
  const number = q("#verifikasi .lp-cert .lp-cert-number") ?? q("#verifikasi .lp-cert p.tabular-nums");
  if (!cert || !phone || !qr || !button || !tag || !number) return { found: ["the demo's parts were not found"], certBox: null, phoneBox: null };
  const R = (e) => e.getBoundingClientRect();
  const inter = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5;
  const inside = (a, b) => a.left >= b.left - 0.5 && a.right <= b.right + 0.5 && a.top >= b.top - 0.5 && a.bottom <= b.bottom + 0.5;
  const name = (e) => `${e.tagName.toLowerCase()}${typeof e.className === "string" && e.className ? "." + e.className.trim().split(/\s+/).slice(0, 2).join(".") : ""}`;
  /** The text of each rendered line of an element (characters grouped by their line box). */
  const lines = (el) => {
    const out = [];
    const range = document.createRange();
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let top = null;
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      for (let i = 0; i < n.textContent.length; i++) {
        range.setStart(n, i);
        range.setEnd(n, i + 1);
        const r = [...range.getClientRects()].find((x) => x.width > 0);
        if (!r) continue;
        if (top === null || Math.abs(r.top - top) > r.height / 2) {
          out.push("");
          top = r.top;
        }
        out[out.length - 1] += n.textContent[i];
      }
    }
    return out.map((l) => l.trim()).filter((l) => l !== "");
  };
  const tokenBreaks = (el, where) => {
    const ls = lines(el);
    ls.slice(0, -1).forEach((l, i) => {
      if (!l.endsWith("-")) found.push(`${where}: the number breaks mid-token after "${l}" (line ${i + 1} of ${ls.length}: ${ls.join(" | ")})`);
    });
  };
  const vw = document.documentElement.clientWidth;
  const c = R(cert);
  const p = R(phone);
  if (inter(c, p)) found.push(`the certificate (${Math.round(c.left)}-${Math.round(c.right)}) and the phone (${Math.round(p.left)}-${Math.round(p.right)}) overlap`);
  for (const [el, what] of [[cert, "certificate"], [phone, "phone"]]) {
    const r = R(el);
    if (r.left < -0.5 || r.right > vw + 0.5) found.push(`the ${what} extends past the viewport (${Math.round(r.left)}-${Math.round(r.right)} of ${vw})`);
  }
  for (const el of cert.querySelectorAll("*")) {
    const r = R(el);
    if (r.width > 0 && r.height > 0 && !inside(r, c)) {
      found.push(`${name(el)} extends past the certificate`);
      break;
    }
  }
  tokenBreaks(number, "certificate");
  for (const [el, what] of [[button, "the button"], [tag, "the sample tag"]]) {
    const n = lines(el).length;
    if (n !== 1) found.push(`${what}'s text is on ${n} lines ("${el.textContent.trim()}")`);
    else if (el.scrollWidth > el.clientWidth + 1) found.push(`${what}'s text overflows its box (${el.scrollWidth} > ${el.clientWidth})`);
  }
  // The QR: fully in view and on top at its corners and centre.
  qr.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
  const r = R(qr);
  const pts = [[r.left + 2, r.top + 2], [r.right - 2, r.top + 2], [r.left + 2, r.bottom - 2], [r.right - 2, r.bottom - 2], [(r.left + r.right) / 2, (r.top + r.bottom) / 2]];
  for (const [x, y] of pts) {
    const hit = document.elementFromPoint(x, y);
    if (!hit || !(hit === qr || qr.contains(hit))) {
      found.push(`the QR is covered at (${Math.round(x)}, ${Math.round(y)}) by ${hit ? name(hit) : "nothing (off-screen)"}`);
      break;
    }
  }
  if (state === "verified") {
    const screen = q("#verifikasi .lp-phone-screen");
    const verdict = q("#verifikasi .lp-verdict");
    const dd = q("#verifikasi .lp-verdict .lp-cert-number") ?? q("#verifikasi .lp-verdict dd");
    if (!verdict || !dd || !screen) found.push("the verdict did not appear");
    else {
      tokenBreaks(dd, "verdict");
      if (!inside(R(verdict), R(screen))) found.push("the verdict extends past the phone's screen");
    }
  }
  const box = (x) => [Math.round(x.width), Math.round(x.height)];
  return { found, certBox: box(R(cert)), phoneBox: box(R(phone)) };
};

const settleFrames = (page) =>
  page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 120)))));

/** The verification-demo sweep (see the header). Returns { rows, failed }. */
async function qrSweep(browser) {
  const rows = [];
  if (QR_SHOTS) fs.mkdirSync(QR_SHOTS, { recursive: true });
  for (const [locale, theme, reduced] of QR_PASSES) {
    const page = await browser.newPage();
    await page.setCookie({ name: "locale", value: locale, url: origin });
    await page.setViewport({ width: QR_WIDTHS[0], height: 900, deviceScaleFactor: 1 });
    await page.emulateMediaFeatures([
      { name: "prefers-reduced-motion", value: reduced ? "reduce" : "no-preference" },
      { name: "prefers-color-scheme", value: theme },
    ]);
    await page.goto(origin + "/", { waitUntil: "networkidle0", timeout: 60000 });
    await page.evaluate(() => document.fonts.ready);
    const isDark = await page.evaluate(() => document.documentElement.classList.contains("dark"));
    const lang = await page.evaluate(() => document.documentElement.lang);
    // Self-test plants, through the CSSOM (the nonce CSP refuses an injected <style>, not a
    // style property): the phone moved onto the QR, a squeezed number, a squeezed button.
    const plant = () =>
      page.evaluate(() => {
        const fig = document.querySelector("#verifikasi figure");
        const qrBox = document.querySelector("#verifikasi .lp-cert svg.lp-qr");
        fig.style.transition = "none"; // a reduced-motion 0.01 ms transition would report the old position
        fig.style.transform = "";
        const f = fig.getBoundingClientRect();
        const q = qrBox.getBoundingClientRect();
        fig.style.transform = `translate(${q.left - f.left}px, ${q.top - f.top}px)`;
        document.querySelector("#verifikasi .lp-cert .lp-cert-number").style.cssText = "width:3.5rem;word-break:break-all";
        document.querySelector("#verifikasi .lp-cert button").style.cssText = "width:5rem;margin-inline:auto";
      });
    const press = () => page.evaluate(() => document.querySelector("#verifikasi .lp-cert button").click());
    for (const width of QR_WIDTHS) {
      await page.setViewport({ width, height: 900, deviceScaleFactor: 1 });
      await page.evaluate(() => document.querySelector("#verifikasi .lp-cert").scrollIntoView({ block: "center", behavior: "instant" }));
      await settleFrames(page);
      if (!reduced) await new Promise((r) => setTimeout(r, 700)); // scroll reveals finish (transform/opacity, <= 600 ms)
      if (SELFTEST) await plant();
      const idle = await page.evaluate(qrAudit, "idle");
      await press();
      if (!reduced) {
        // The scan runs 1.1 s: the verdict must NOT be there at once, and must be there after.
        const early = await page.evaluate(() => document.querySelector("#verifikasi .lp-verdict") !== null);
        if (early) idle.found.push("the verdict appeared at once without reduced motion (no scan)");
        await new Promise((r) => setTimeout(r, 1500));
      }
      await settleFrames(page);
      const verified = await page.evaluate(qrAudit, "verified");
      const live = await page.evaluate(() => document.querySelector('#verifikasi [role="status"]')?.textContent ?? "");
      const found = [...idle.found.map((f) => `idle: ${f}`), ...verified.found.map((f) => `verified: ${f}`)];
      if (!live.trim()) found.push("verified: the live region is empty");
      const shifted = (a, b) => a && b && (Math.abs(a[0] - b[0]) > 1 || Math.abs(a[1] - b[1]) > 1);
      if (shifted(idle.certBox, verified.certBox)) found.push(`layout shift: the certificate ${idle.certBox.join("x")} -> ${verified.certBox.join("x")}`);
      if (shifted(idle.phoneBox, verified.phoneBox)) found.push(`layout shift: the phone ${idle.phoneBox.join("x")} -> ${verified.phoneBox.join("x")}`);
      if ((theme === "dark") !== isDark) found.push(`the page is not in the ${theme} theme`);
      if (lang !== locale) found.push(`lang is ${lang}, not ${locale}`);
      if (QR_SHOTS && reduced && locale === "en" && QR_SHOT_WIDTHS.includes(width)) {
        await page.evaluate(() => document.querySelector("#verifikasi .lp-cert").parentElement.scrollIntoView({ block: "center", behavior: "instant" }));
        await settleFrames(page);
        const clip = await page.evaluate(() => {
          const r = document.querySelector("#verifikasi .lp-cert").parentElement.getBoundingClientRect();
          return { x: 0, y: Math.max(0, r.top + window.scrollY - 32), width: document.documentElement.clientWidth, height: Math.ceil(r.height) + 64 };
        });
        const file = path.join(QR_SHOTS, `p1017-fix-qr-${QR_SHOT_TAG}-${theme}-${width}.webp`);
        await page.screenshot({ path: file, type: "webp", quality: 80, clip, captureBeyondViewport: true });
      }
      await press(); // back to idle
      await settleFrames(page);
      rows.push({ name: `${locale} ${theme} ${reduced ? "reduced" : "motion"} ${width}`, found });
    }
    await page.close();
  }
  let failed = 0;
  for (const r of rows) {
    // Self-test: every row must report the planted overlap, the mid-token break and the two-line button.
    const bad = SELFTEST
      ? !(r.found.some((f) => f.includes("overlap")) && r.found.some((f) => f.includes("mid-token")) && r.found.some((f) => f.includes("the button's text")))
      : r.found.length > 0;
    if (bad) failed++;
    console.log(`${bad ? "FAIL" : "ok  "} qr-demo\t${r.name}\tfindings=${r.found.length}`);
    if (!SELFTEST || bad) for (const f of r.found.slice(0, 8)) console.log("     QR " + f);
  }
  return { rows, failed };
}

(async () => {
  if (out) fs.mkdirSync(out, { recursive: true });
  const sharp = out ? require("sharp") : null;
  const browser = await puppeteer.launch({ executablePath: chromePath(), headless: true, args: ["--no-sandbox", "--hide-scrollbars"] });
  const rows = [];
  let qr = { rows: [], failed: 0 };
  try {
    if (QR_ON) qr = await qrSweep(browser);
    for (const [name, route] of QR_ONLY ? [] : PAGES) {
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
  if (!QR_ONLY) console.log(SELFTEST ? `${rows.length - failed}/${rows.length} pairs detected the planted defect` : `${rows.length - failed}/${rows.length} page-mode pairs clean`);
  if (QR_ON) console.log(SELFTEST ? `${qr.rows.length - qr.failed}/${qr.rows.length} demo rows detected the planted defects` : `${qr.rows.length - qr.failed}/${qr.rows.length} demo rows clean`);
  if (failed > 0 || qr.failed > 0) process.exit(1);
})().catch((e) => { console.error(e); process.exit(1); });
