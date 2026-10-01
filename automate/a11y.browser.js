#!/usr/bin/env node
/**
 * Browser accessibility suite (ADR-090 follow-up; F-12 "axe in the browser
 * suite"). The sibling of automate/smoke.browser.js (ADR-077), run by
 * `make test-browser` after it, on the same tools: the repository's
 * `puppeteer-core` and `axe-core` (both already dependencies — nothing new)
 * and an installed Chrome/Chromium.
 *
 * What it checks, in the light AND the dark theme:
 *
 *   1. axe      every key public page (signed out) and dashboard page (signed
 *               in through the login form) has 0 WCAG 2.1 AA findings — axe
 *               tags wcag2a, wcag2aa, wcag21a, wcag21aa. `best-practice`
 *               findings (landmarks, heading order) are printed as WARN
 *               lines and fail the run only with A11Y_STRICT=1 (ADR-090
 *               took both sets to 0; best-practice is not WCAG).
 *   2. dialogs  on the key pages with a create dialog, the first visible
 *               "Add / New / Create / Register…" button in <main> opens a
 *               dialog that: takes focus, keeps it through 25 × Tab, is
 *               axe-clean while open, closes on Escape, and gives focus back
 *               to the button (WCAG 2.1.2, 2.4.3).
 *   3. reflow   at 200% zoom (a 1366 × 900 window zoomed to 200% lays out at
 *               683 × 450 CSS px), no key page scrolls sideways (WCAG 1.4.4,
 *               1.4.10) — a wide table may scroll inside its own container.
 *   4. motion   with `prefers-reduced-motion: reduce`, no key page runs a CSS
 *               animation or transition longer than 0.2 s, except a
 *               busy indicator that says so (role="status" / aria-busy, or a
 *               spinner: `animate-spin`) — WCAG 2.3.3's intent, which the
 *               stylesheet's reduced-motion block (globals.css) promises.
 *   5. brand    with the tenant's brand colour set to one that fails the
 *               ADR-090 rule in the light theme (#ffff00, 1.07:1 on white),
 *               the dashboard shows a derived primary that passes, in both
 *               themes, and stays axe-clean (ADR-090 amendment). The colour is
 *               set on the tenant the run's user belongs to (the seeded
 *               operator's) and restored afterwards.
 *
 * It runs against a RUNNING, seeded stack (GET /api/v1/migration/seeding),
 * like the smoke. The tenant administrator it signs in with, and the device
 * that gives the device list a row, are created for the run through the API
 * (as the seeded operator, via the E2E harness) and deleted afterwards.
 *
 *   FRONTEND_URL=http://localhost:3001 BASE_URL=http://localhost:3000 \
 *     node automate/a11y.browser.js
 *
 * Environment: FRONTEND_URL, BASE_URL, CHROME_PATH, E2E_OPERATOR,
 * E2E_OPERATOR_PASSWORD, HEADFUL — as for the smoke; and
 *   A11Y_ONLY=axe,dialogs,reflow,motion,brand   run a subset
 *   A11Y_STRICT=1                         best-practice findings fail too
 *   A11Y_ARTIFACTS=<dir>                  where failure screenshots go (default: the OS temp dir)
 *
 * Exit status 0 only when every check passed. Not part of `make verify`.
 * How to bring up a local stack for it: MEMORY/records/2026-09-29-feauto-a11y-f05-brand.md.
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const FRONTEND_URL = (process.env.FRONTEND_URL || "http://localhost:3001").replace(/\/$/, "");
process.env.BASE_URL = process.env.BASE_URL || "http://localhost:3000";

const puppeteer = require("puppeteer-core");
const api = require(path.join(__dirname, "../backend/src/tests/e2e/setup.js"));
const AXE_SOURCE = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

const OPERATOR = process.env.E2E_OPERATOR || "sys@mail.com";
// P10-16 (ADR-099): no default operator password; e2e/setup.js refuses to load without one.
const OPERATOR_PASSWORD = api.OPERATOR_PASSWORD;
const STEP_TIMEOUT = 30000;
const ARTIFACTS = process.env.A11Y_ARTIFACTS || os.tmpdir();
const ONLY = (process.env.A11Y_ONLY || "axe,dialogs,reflow,motion,brand").split(",").map((s) => s.trim());

/** Signed-out pages. */
const PUBLIC_PAGES = ["/", "/login", "/register", "/activation", "/blog", "/news"];

/** Signed-in pages: the ones a hospital's tenant administrator works in daily. */
const DASHBOARD_PAGES = [
  "/dashboard",
  "/dashboard/devices",
  "/dashboard/calibration",
  "/dashboard/calibration-scheduler",
  "/dashboard/maintenance",
  "/dashboard/users",
  "/dashboard/roles",
  "/dashboard/vendors",
  "/dashboard/stock",
  "/dashboard/warehouses",
  "/dashboard/notifications",
  "/dashboard/profile",
  "/dashboard/tickets/raise",
  "/dashboard/audit",
  "/dashboard/sop",
  "/dashboard/qms",
  "/dashboard/risk",
  "/dashboard/session-management",
  "/dashboard/reports",
  "/dashboard/gdpr",
];

/** Pages whose first create button opens a dialog (ADR-090's sweep found 24; these are the key ones). */
const DIALOG_PAGES = [
  "/dashboard/devices",
  "/dashboard/maintenance",
  "/dashboard/users",
  "/dashboard/vendors",
  "/dashboard/warehouses",
  "/dashboard/roles",
];

/** Pages checked for reflow at 200% zoom and for reduced motion. */
const LAYOUT_PAGES = ["/", "/login", "/dashboard", "/dashboard/devices", "/dashboard/users", "/dashboard/maintenance"];

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

// ---------------------------------------------------------------- helpers

function chromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) throw new Error(`No Chrome/Chromium found; set CHROME_PATH (tried: ${candidates.join(", ")})`);
  return found;
}

const results = [];
async function check(name, page, fn) {
  const started = Date.now();
  try {
    const detail = await fn();
    results.push({ name, ok: true });
    console.log(`  PASS  ${name} (${Date.now() - started} ms)${detail ? ` — ${detail}` : ""}`);
  } catch (err) {
    results.push({ name, ok: false });
    console.log(`  FAIL  ${name} (${Date.now() - started} ms)\n        ${err.message.split("\n").join("\n        ")}`);
    if (page) {
      const shot = path.join(ARTIFACTS, `browser-a11y-failure-${Date.now()}.png`);
      await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
      console.log(`        at ${page.url()}; screenshot ${shot}`);
    }
  }
}

/** Wait (bounded) until every finite animation and transition has ended. */
const animationsDone = (page, ms) =>
  page
    .evaluate(
      (limit) =>
        Promise.race([
          Promise.all(
            document
              .getAnimations()
              .filter((a) => a.effect && a.effect.getComputedTiming().endTime !== Infinity)
              .map((a) => a.finished.catch(() => {})),
          ),
          new Promise((r) => setTimeout(r, limit)),
        ]),
      ms,
    )
    .catch(() => {});

/** Let the page finish loading and its entrance animations end. */
async function settle(page) {
  // The dashboard keeps a socket open, so "idle" may never come: bounded.
  await page.waitForNetworkIdle({ idleTime: 500, timeout: 6000 }).catch(() => {});
  // Reveal-on-scroll content is shown by scrolling it into view; the
  // animations it starts are waited for AFTER the scroll, or axe measures a
  // half-faded colour (seen on the dashboard's stat cards).
  await page
    .evaluate(async () => {
      const step = Math.max(200, Math.floor(innerHeight * 0.8));
      for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
        scrollTo(0, y);
        await new Promise((r) => setTimeout(r, 60));
      }
      scrollTo(0, 0);
    })
    .catch(() => {});
  await new Promise((r) => setTimeout(r, 150));
  // A loading skeleton pulses its opacity forever, so axe measures a
  // half-faded placeholder (seen on /dashboard/sop, dark). Wait (bounded) for
  // the data to replace it. A page that stays loading is checked as it is.
  await page
    .waitForFunction(
      () => !document.querySelector("main .animate-pulse, main [aria-busy='true']"),
      { timeout: 15000 },
    )
    .catch(() => {});
  await animationsDone(page, 5000);
  await new Promise((r) => setTimeout(r, 200));
}

async function goto(page, url) {
  const res = await page.goto(`${FRONTEND_URL}${url}`, { waitUntil: "domcontentloaded", timeout: STEP_TIMEOUT });
  // A page is checked once it has rendered, not while the app shell's
  // spinner is up (an axe pass on a spinner proves nothing). ADR-090: every
  // page has one <main> with one <h1> — any one visible, since a page may
  // carry a second for another breakpoint (/login's brand name below lg).
  await page
    .waitForFunction(
      () =>
        [...document.querySelectorAll("main h1")].some((h) => {
          const r = h.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && getComputedStyle(h).visibility !== "hidden";
        }),
      { timeout: STEP_TIMEOUT },
    )
    .catch(() => {
      throw new Error(`${url} never rendered a visible <h1> in <main> (still loading, or the landmark is gone)`);
    });
  await settle(page);
  return res;
}

/** axe on the document (or `selector`), WCAG 2.1 AA and best-practice, violations only. */
async function runAxe(page, selector) {
  const hasAxe = await page.evaluate(() => typeof window.axe !== "undefined");
  // Evaluated over the DevTools protocol, so the page's nonce CSP does not apply.
  if (!hasAxe) await page.evaluate(AXE_SOURCE);
  return page.evaluate(
    async (sel, wcagTags) => {
      const context = sel ? document.querySelector(sel) : document;
      const res = await window.axe.run(context, {
        runOnly: { type: "tag", values: [...wcagTags, "best-practice"] },
        resultTypes: ["violations"],
      });
      return res.violations.map((v) => ({
        id: v.id,
        wcag: v.tags.some((t) => wcagTags.includes(t)),
        nodes: v.nodes.map((n) => `${n.target.join(" ")} — ${(n.failureSummary || "").split("\n").slice(1).join("; ")}`),
      }));
    },
    selector || null,
    WCAG_TAGS,
  );
}

const STRICT = process.env.A11Y_STRICT === "1";
const warnings = [];

/**
 * Fail on WCAG findings (and on best-practice ones under A11Y_STRICT=1);
 * otherwise record best-practice findings as warnings. Returns the detail.
 */
function assertAxe(violations, where) {
  const failing = violations.filter((v) => v.wcag || STRICT);
  const warned = violations.filter((v) => !v.wcag && !STRICT);
  if (failing.length) throw new Error(describeViolations(failing));
  if (warned.length) {
    warnings.push(`${where}\n  ${describeViolations(warned).split("\n").join("\n  ")}`);
    return `0 WCAG findings; ${warned.length} best-practice warning(s)`;
  }
  return "0 findings";
}

const describeViolations = (violations) =>
  violations
    .map((v) => `[${v.wcag ? "WCAG" : "best-practice"}] ${v.id} × ${v.nodes.length}\n    ${v.nodes.slice(0, 4).join("\n    ")}`)
    .join("\n");

async function passwordSignIn(page, email, password) {
  await page.goto(`${FRONTEND_URL}/login`, { waitUntil: "networkidle2", timeout: STEP_TIMEOUT });
  await page.waitForSelector("#username", { timeout: STEP_TIMEOUT });
  await page.type("#username", email);
  // ADR-098 (Phase 10): sign-in is identifier-first. The password field
  // appears after the identifier is submitted; the older one-step form has it
  // from the start. Handle both.
  // The submit button of THIS form: the public header's language switcher is
  // a form with submit buttons of its own, earlier in the document.
  // A click that lands before the page has hydrated submits nothing, so it
  // is retried until the password field appears.
  for (let attempt = 1; !(await page.$("#password")); attempt++) {
    await page.click('form:has(#username) button[type="submit"]');
    const shown = await page
      .waitForSelector("#password", { visible: true, timeout: attempt < 3 ? 5000 : STEP_TIMEOUT })
      .then(() => true)
      .catch(() => false);
    if (shown) break;
    if (attempt >= 3) {
      const text = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 300));
      throw new Error(`the password step never appeared after the identifier; the page says: ${text}`);
    }
  }
  await page.type("#password", password);
  // On a loaded machine the backend's own sign-in budget (30 s) can run out
  // and answer 408. That is the environment, not the page, so one retry.
  for (let attempt = 1; ; attempt++) {
    const arrived = await Promise.all([
      page.waitForFunction(() => location.pathname.startsWith("/dashboard"), { timeout: 60000 }),
      page.click('form:has(#password) button[type="submit"]'),
    ])
      .then(() => true)
      .catch(() => false);
    if (arrived) return;
    if (attempt >= 2 || !(await page.$("#password"))) {
      const text = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 300));
      throw new Error(`sign-in did not reach /dashboard; the page says: ${text}`);
    }
    console.log(`  RETRY sign-in (attempt ${attempt} did not reach /dashboard in 60 s)`);
  }
}

/** A new context whose pages start in `theme` and, optionally, reduced motion. */
async function newThemedPage(browser, theme, { viewport, reducedMotion } = {}) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport(viewport || { width: 1366, height: 900 });
  await page.evaluateOnNewDocument((t) => {
    try {
      localStorage.setItem("hdc-theme-preference", t);
    } catch {
      /* storage blocked: the default (light) applies */
    }
  }, theme);
  await page.emulateMediaFeatures([
    { name: "prefers-color-scheme", value: theme },
    { name: "prefers-reduced-motion", value: reducedMotion ? "reduce" : "no-preference" },
  ]);
  return { context, page };
}

/**
 * Replace an administrator-set password (A-123) and return the HTTP status.
 * Since the one-time rule reached administrator passwords (ADR-099's
 * follow-up), the first sign-in answers `data.passwordChangeRequired` and a
 * `password-change` token, not a session, and the change goes to
 * POST /auth/first-sign-in/password. An older backend answers a gated session
 * that /auth/just-update-password accepts. Both are handled.
 */
async function replaceTemporaryPassword(identifier, temporary, newPassword) {
  const res = await fetch(`${api.API_BASE}/auth/login`, {
    method: "POST",
    headers: api.defaultHeaders,
    body: JSON.stringify({ user: identifier, password: temporary }),
  });
  const body = await res.json().catch(() => ({}));
  if (body?.data?.passwordChangeRequired && body.token) {
    const r = await fetch(`${api.API_BASE}/auth/first-sign-in/password`, {
      method: "POST",
      headers: api.defaultHeaders,
      body: JSON.stringify({ token: body.token, newPassword }),
    });
    return r.status;
  }
  const changed = await api.httpPost(
    "/auth/just-update-password",
    { currentPassword: temporary, newPassword },
    api.authHeader(api.extractToken(body)),
  );
  return changed.status;
}

// ---------------------------------------------------------------- checks

async function axeSweep(browser, theme, user) {
  const { context, page } = await newThemedPage(browser, theme);
  try {
    for (const url of PUBLIC_PAGES) {
      await check(`axe [${theme}] ${url}`, page, async () => {
        await goto(page, url);
        const isDark = await page.evaluate(() => document.documentElement.classList.contains("dark"));
        if (isDark !== (theme === "dark")) throw new Error(`the page is not in the ${theme} theme`);
        return assertAxe(await runAxe(page), `${theme} ${url}`);
      });
    }
    await passwordSignIn(page, user.email, user.password);
    for (const url of DASHBOARD_PAGES) {
      await check(`axe [${theme}] ${url}`, page, async () => {
        await goto(page, url);
        if (!new URL(page.url()).pathname.startsWith("/dashboard")) {
          throw new Error(`redirected to ${page.url()} — the session was lost`);
        }
        return assertAxe(await runAxe(page), `${theme} ${url}`);
      });
    }
  } finally {
    await context.close();
  }
}

async function dialogContract(browser, theme, user) {
  const { context, page } = await newThemedPage(browser, theme);
  try {
    await passwordSignIn(page, user.email, user.password);
    for (const url of DIALOG_PAGES) {
      await check(`dialog [${theme}] ${url}: focus in, trapped, axe-clean, Escape, focus back`, page, async () => {
        await goto(page, url);
        // Waited for, not looked up once: a list page may render its header
        // before its permissions resolve and the button appears.
        const opener = await page
          .waitForFunction(
            () => {
              const re = /^\s*(add|new|create|register|raise|upload)\b/i;
              const buttons = [...document.querySelectorAll("main button")].filter((b) => {
                const r = b.getBoundingClientRect();
                return re.test(b.textContent || "") && !b.disabled && r.width > 0 && r.height > 0;
              });
              if (!buttons.length) return null;
              buttons[0].setAttribute("data-a11y-opener", "");
              return buttons[0].textContent.trim();
            },
            { timeout: 10000 },
          )
          .then((h) => h.jsonValue())
          .catch(() => null);
        if (!opener) throw new Error("no visible Add/New/Create button in <main>");
        await page.click("[data-a11y-opener]");
        await page.waitForSelector('[role="dialog"], [role="alertdialog"]', { visible: true, timeout: 10000 });
        await settle(page);

        const inDialog = () =>
          page.evaluate(() => {
            const d = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].pop();
            return Boolean(d && d.contains(document.activeElement));
          });
        if (!(await inDialog())) throw new Error(`"${opener}": focus did not move into the dialog`);
        for (let i = 0; i < 25; i++) {
          await page.keyboard.press("Tab");
          if (!(await inDialog())) throw new Error(`"${opener}": Tab ${i + 1} left the dialog`);
        }
        try {
          assertAxe(await runAxe(page, '[role="dialog"], [role="alertdialog"]'), `${theme} ${url} "${opener}" dialog`);
        } catch (err) {
          throw new Error(`"${opener}" dialog:\n${err.message}`);
        }

        await page.keyboard.press("Escape");
        await page.waitForFunction(() => !document.querySelector('[role="dialog"], [role="alertdialog"]'), {
          timeout: 5000,
        }).catch(() => {
          throw new Error(`"${opener}": Escape did not close the dialog`);
        });
        await new Promise((r) => setTimeout(r, 150));
        const back = await page.evaluate(() => document.activeElement?.hasAttribute("data-a11y-opener") ?? false);
        if (!back) throw new Error(`"${opener}": focus did not return to the button that opened the dialog`);
        return `"${opener}"`;
      });
    }
  } finally {
    await context.close();
  }
}

async function reflowAt200(browser, user) {
  // 1366 × 900 at 200% zoom: the page lays out in 683 × 450 CSS px.
  const { context, page } = await newThemedPage(browser, "light", {
    viewport: { width: 683, height: 450, deviceScaleFactor: 2 },
  });
  try {
    let signedIn = false;
    for (const url of LAYOUT_PAGES) {
      if (url.startsWith("/dashboard") && !signedIn) {
        await passwordSignIn(page, user.email, user.password);
        signedIn = true;
      }
      await check(`reflow at 200% zoom ${url}: no sideways page scroll`, page, async () => {
        await goto(page, url);
        const r = await page.evaluate(() => {
          const doc = document.scrollingElement || document.documentElement;
          // What sticks out, ignoring content inside a container that scrolls itself.
          const scrollsItself = (el) => {
            for (let p = el.parentElement; p; p = p.parentElement) {
              const o = getComputedStyle(p).overflowX;
              if ((o === "auto" || o === "scroll" || o === "hidden" || o === "clip") && p !== document.body && p !== document.documentElement) return true;
            }
            return false;
          };
          const offenders = [...document.body.querySelectorAll("*")]
            .filter((el) => {
              const b = el.getBoundingClientRect();
              return b.width > 0 && b.right > innerWidth + 1 && !scrollsItself(el) && getComputedStyle(el).position !== "fixed";
            })
            .slice(0, 5)
            .map((el) => `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}.${[...el.classList].slice(0, 4).join(".")} (right ${Math.round(el.getBoundingClientRect().right)})`);
          return { scrollWidth: doc.scrollWidth, innerWidth, offenders };
        });
        if (r.scrollWidth > r.innerWidth + 1) {
          throw new Error(`page is ${r.scrollWidth}px wide in a ${r.innerWidth}px viewport; sticking out: ${r.offenders.join(", ") || "(none found)"}`);
        }
        return `${r.scrollWidth}px ≤ ${r.innerWidth}px`;
      });
    }
  } finally {
    await context.close();
  }
}

async function reducedMotion(browser, user) {
  const { context, page } = await newThemedPage(browser, "light", { reducedMotion: true });
  try {
    let signedIn = false;
    for (const url of LAYOUT_PAGES) {
      if (url.startsWith("/dashboard") && !signedIn) {
        await passwordSignIn(page, user.email, user.password);
        signedIn = true;
      }
      await check(`reduced motion ${url}: no animation longer than 0.2 s`, page, async () => {
        await page.goto(`${FRONTEND_URL}${url}`, { waitUntil: "domcontentloaded", timeout: STEP_TIMEOUT });
        await page.waitForNetworkIdle({ idleTime: 500, timeout: 6000 }).catch(() => {});
        // Sample while the page is doing whatever it does on load and on scroll.
        const offenders = await page.evaluate(async () => {
          const seen = new Map();
          const busy = (el) =>
            Boolean(el && el.closest('[role="status"], [aria-busy="true"], [role="progressbar"], .animate-spin'));
          const sample = () => {
            for (const a of document.getAnimations()) {
              const t = a.effect && a.effect.getComputedTiming();
              const target = a.effect && a.effect.target;
              if (!t || busy(target)) continue;
              const long = t.duration === Infinity || t.iterations === Infinity || Number(t.duration) > 200;
              if (!long) continue;
              const name = a.animationName || a.transitionProperty || a.constructor.name;
              const key = `${target?.tagName?.toLowerCase()}.${[...(target?.classList || [])].slice(0, 3).join(".")} ${name} ${Math.round(Number(t.duration))}ms`;
              seen.set(key, true);
            }
          };
          sample();
          const step = Math.max(200, Math.floor(innerHeight * 0.8));
          for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
            scrollTo(0, y);
            await new Promise((r) => setTimeout(r, 80));
            sample();
          }
          return [...seen.keys()];
        });
        // Script-driven motion (GSAP, Lenis) does not show in getAnimations;
        // the smooth-scroll wrapper announces itself by a class on <html>.
        const smooth = await page.evaluate(() => document.documentElement.classList.contains("lenis"));
        if (smooth) offenders.push("html.lenis smooth scrolling is active");
        if (offenders.length) throw new Error(offenders.slice(0, 8).join("\n"));
        return "none";
      });
    }
  } finally {
    await context.close();
  }
}

/** The WCAG 2.x contrast of two #rrggbb colours (the same formula axe uses). */
function contrast(a, b) {
  const lum = (h) => {
    // The built CSS is minified: `#ffffff` arrives as `#fff`.
    let hex = h.trim().replace("#", "");
    if (hex.length === 3) hex = [...hex].map((c) => c + c).join("");
    const n = parseInt(hex, 16);
    const [r, g, bl] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const BRAND_COLOUR = "#ffff00";

async function brandColour(browser, user, adminAtStart, tenantId, freshAdmin) {
  let admin = adminAtStart;
  const detail = await api.httpPost("/tenants/detail", { tenantId }, admin);
  const original = detail.body?.data?.primaryColor ?? null;
  // The harness has no PATCH helper; this is the tenant edit form's own call.
  const set = (colour) =>
    fetch(`${api.API_BASE}/tenants/edit`, {
      method: "PATCH",
      headers: { ...api.defaultHeaders, ...admin },
      body: JSON.stringify({ tenantId, primaryColor: colour }),
    }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
  const saved = await set(BRAND_COLOUR);
  if (saved.status !== 200) throw new Error(`setting the tenant brand colour failed (${saved.status}: ${saved.body?.message})`);
  try {
    for (const theme of ["light", "dark"]) {
      const { context, page } = await newThemedPage(browser, theme);
      try {
        await passwordSignIn(page, user.email, user.password);
        for (const url of ["/dashboard", "/dashboard/devices"]) {
          await check(`brand [${theme}] ${url}: ${BRAND_COLOUR} is shown as a readable shade, axe-clean`, page, async () => {
            await goto(page, url);
            await page.waitForFunction(() => document.documentElement.hasAttribute("data-tenant-brand"), { timeout: 10000 })
              .catch(() => { throw new Error("the tenant brand colour was never applied (no html[data-tenant-brand])"); });
            const got = await page.evaluate(() => {
              const cs = getComputedStyle(document.documentElement);
              const card = cs.getPropertyValue("--card").trim();
              return { primary: cs.getPropertyValue("--primary").trim(), fg: cs.getPropertyValue("--primary-foreground").trim(), card };
            });
            const onCard = contrast(got.primary, got.card);
            const fill = contrast(got.fg, got.primary);
            if (onCard < 4.5 || fill < 4.5) {
              throw new Error(`--primary ${got.primary} is ${onCard.toFixed(2)}:1 on the card ${got.card}; its foreground ${got.fg} is ${fill.toFixed(2)}:1 on it`);
            }
            assertAxe(await runAxe(page), `brand ${theme} ${url}`);
            return `--primary ${got.primary} (${onCard.toFixed(2)}:1 on the card), foreground ${fill.toFixed(2)}:1`;
          });
        }
      } finally {
        await context.close();
      }
    }
  } finally {
    admin = await freshAdmin();
    const restored = await set(original || "");
    if (restored.status !== 200) console.log(`  WARN  the tenant brand colour was not restored (${restored.status}); it is ${BRAND_COLOUR}`);
  }
}

// ---------------------------------------------------------------- run

async function main() {
  const started = Date.now();
  console.log(`Browser a11y — frontend ${FRONTEND_URL}, API ${process.env.BASE_URL}; checks: ${ONLY.join(", ")}`);

  const signIn = await api.httpPost("/auth/login", { user: OPERATOR, password: OPERATOR_PASSWORD });
  const adminToken = api.extractToken(signIn.body);
  if (signIn.status !== 200 || !adminToken) throw new Error(`API sign-in as ${OPERATOR} failed (${signIn.status})`);
  let admin = api.authHeader(adminToken);
  // The access token may live only a minute (a JWT_ACCESS_EXPIRED=60s stack);
  // anything after the browser checks signs in again.
  const freshAdmin = async () => {
    const again = await api.httpPost("/auth/login", { user: OPERATOR, password: OPERATOR_PASSWORD });
    const token = api.extractToken(again.body);
    if (again.status === 200 && token) admin = api.authHeader(token);
    return admin;
  };
  const tenantId = signIn.body.data.tenantId;
  const roles = await api.httpGet("/roles?limit=50", admin);
  const role = (roles.body.data || []).find((r) => /^healthcare admin$/i.test(r.name)) ||
    (roles.body.data || []).find((r) => Number(r.roleLevel) === 8);
  if (!role) throw new Error("no HEALTHCARE ADMIN (level 8) role in GET /roles");

  const stamp = Date.now();
  const user = { email: `browser-a11y-${stamp}@example.com`, password: `A11y-${stamp}-Bb2!` };
  const temporary = `Temp-${stamp}-Aa1!`;
  let userId = null;
  let deviceId = null;
  const created = await api.httpPost(
    "/users/create",
    { tenantId, username: `ba11y${stamp}`.slice(0, 20), firstName: "Browser", lastName: "Accessibility",
      email: user.email, password: temporary, roleId: role.id },
    admin,
  );
  if (created.status !== 201) throw new Error(`creating the a11y user failed (${created.status}: ${created.body?.message})`);
  userId = created.body.data.id;

  let browser = null;
  try {
    const device = await api.httpPost(
      "/calibration-devices",
      { name: `A11y Device ${stamp}`, manufacturer: "A11y", model: "A-1", serialNumber: `BA-${stamp}`, status: "active" },
      admin,
    );
    if (device.status !== 201) throw new Error(`creating the a11y device failed (${device.status})`);
    deviceId = device.body.data.id;

    // The administrator-set password is replaced through the API (A-123), as the smoke does.
    const changed = await replaceTemporaryPassword(user.email, temporary, user.password);
    if (changed !== 200) throw new Error(`setting the a11y user's password failed (${changed})`);

    browser = await puppeteer.launch({
      executablePath: chromePath(),
      headless: process.env.HEADFUL ? false : true,
      args: ["--no-first-run", "--no-default-browser-check"],
    });
    for (const theme of ["light", "dark"]) {
      if (ONLY.includes("axe")) await axeSweep(browser, theme, user);
      if (ONLY.includes("dialogs")) await dialogContract(browser, theme, user);
    }
    if (ONLY.includes("reflow")) await reflowAt200(browser, user);
    if (ONLY.includes("motion")) await reducedMotion(browser, user);
    if (ONLY.includes("brand")) await brandColour(browser, user, await freshAdmin(), tenantId, freshAdmin);
  } finally {
    if (browser) await browser.close();
    await freshAdmin().catch(() => {});
    if (deviceId) await api.httpDelete(`/calibration-devices/${deviceId}`, admin).catch(() => {});
    if (userId) await api.httpDelete(`/users/delete?userId=${userId}`, admin).catch(() => {});
  }

  if (warnings.length) {
    console.log(`\n  best-practice warnings (not WCAG; fail with A11Y_STRICT=1):\n  WARN ${warnings.join("\n  WARN ")}`);
  }
  const passed = results.filter((r) => r.ok).length;
  const ok = results.length > 0 && passed === results.length;
  console.log(`\n${passed}/${results.length} checks passed in ${Date.now() - started} ms${ok ? "" : " — FAILED"}`);
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(`Browser a11y could not run: ${err.message}`);
  process.exit(2);
});
