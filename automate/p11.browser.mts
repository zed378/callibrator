#!/usr/bin/env node
/**
 * P11-02 / P11-07 (ADR-122) — the dashboard's warm palette and the one theme
 * mechanism, in a real browser:
 *
 *   continuity  the light/dark choice carries both ways between the landing
 *               and the dashboard, and with no choice both follow the device
 *               (spec P11-00 §6.4):
 *                 a. no choice + prefers-color-scheme: dark → `/` and
 *                    `/dashboard` are both dark, already at the first frame;
 *                 b. choose dark on `/` (the public toggle) → `/dashboard` dark;
 *                 c. choose light in the dashboard (its toggle) → a public
 *                    surface in the SAME document is light (D9: no reload),
 *                    and `/` after navigating is light;
 *                 d. "Use device setting" (profile page) clears the choice and
 *                    the dashboard follows the device again.
 *   axe         the main dashboard pages, light AND dark, at 360, 768, 1280
 *               and 1536 px wide: 0 WCAG 2.1 A/AA findings.
 *   states      the states the route sweep never opens, where spec D1–D3 hid:
 *               the tenant backup "Create Backup" dialog (D1), the SAML SSO
 *               panel (D2), the notification panel (D7), a create dialog —
 *               axe-clean in both themes.
 *   shots       WebP screenshots of the key pages in both themes into
 *               P11_SHOTS (default docs/UI-UX/research/screens), named
 *               `p11-<P11_SHOT_TAG>-<page>-<theme>-<width>.webp`.
 *
 * TypeScript, run by Node itself (type stripping): `node automate/p11.browser.mts`,
 * checked by automate/tsconfig.json. Dependencies are the repository's own
 * (puppeteer-core, axe-core, the E2E harness).
 *
 * It runs against a RUNNING, seeded stack (GET /api/v1/migration/seeding),
 * signed in as the operator (E2E_OPERATOR / E2E_OPERATOR_PASSWORD; on a fresh
 * stack also E2E_BOOTSTRAP_PASSWORD, which the harness uses once). It creates
 * four devices (one per status) for the run and deletes them afterwards.
 *
 *   FRONTEND_URL=http://localhost:27186 BASE_URL=http://127.0.0.1:27185 \
 *   E2E_OPERATOR_PASSWORD=… node automate/p11.browser.mts
 *
 * Environment: P11_ONLY=continuity,axe,states,shots (default: all but shots),
 * P11_SHOTS=<dir>, P11_SHOT_TAG=<tag> (default "after"), CHROME_PATH,
 * HEADFUL=1, P11_ARTIFACTS=<dir> (failure screenshots).
 *
 * Exit status 0 only when every check passed. Not part of `make verify`.
 */
import { createRequire } from "node:module";
import { createHash, createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import puppeteer from "puppeteer-core";
import type { Browser, BrowserContext, Page } from "puppeteer-core";

const require = createRequire(import.meta.url);
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));

const FRONTEND_URL = (process.env["FRONTEND_URL"] ?? "http://localhost:3001").replace(/\/$/, "");
process.env["BASE_URL"] = process.env["BASE_URL"] ?? "http://localhost:3000";
const STEP_TIMEOUT = 30000;
const ONLY = (process.env["P11_ONLY"] ?? "continuity,axe,states").split(",").map((s) => s.trim());
const SHOTS_ON = ONLY.includes("shots");
const SHOTS = process.env["P11_SHOTS"] ?? path.join(here, "../docs/UI-UX/research/screens");
const SHOT_TAG = process.env["P11_SHOT_TAG"] ?? "after";
const ARTIFACTS = process.env["P11_ARTIFACTS"] ?? os.tmpdir();
const STORAGE_KEY = "hdc-theme-preference";

interface Reply {
  status: number;
  body: unknown;
}
interface Harness {
  OPERATOR: string;
  OPERATOR_PASSWORD: string;
  httpPost: (path: string, body: unknown, headers?: Record<string, string>) => Promise<Reply>;
  httpDelete: (path: string, headers?: Record<string, string>) => Promise<Reply>;
  extractToken: (body: unknown) => string | null;
  authHeader: (token: string | null) => Record<string, string>;
}
const api = require(path.join(here, "../backend/src/tests/e2e/setup.js")) as Harness;
const AXE_SOURCE = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

type Theme = "light" | "dark";
const THEMES: Theme[] = ["light", "dark"];
const WIDTHS = [360, 768, 1280, 1536];

/** The pages a tenant administrator and the operator work in daily. */
const AXE_PAGES = [
  "/dashboard",
  "/dashboard/devices",
  "/dashboard/calibration",
  "/dashboard/maintenance",
  "/dashboard/users",
  "/dashboard/vendors",
  "/dashboard/tenants",
  "/dashboard/kanban",
  "/dashboard/profile",
];

const obj = (v: unknown): Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const chromePath = (): string => {
  const candidates = [
    process.env["CHROME_PATH"],
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter((p): p is string => typeof p === "string" && p !== "");
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) throw new Error(`No Chrome/Chromium found; set CHROME_PATH (tried: ${candidates.join(", ")})`);
  return found;
};

// ---------------------------------------------------------------- the run's record

const results: { name: string; ok: boolean }[] = [];
let currentPage: Page | null = null;

const check = async (name: string, fn: () => Promise<string>): Promise<boolean> => {
  const started = Date.now();
  try {
    const detail = await fn();
    results.push({ name, ok: true });
    console.log(`  PASS  ${name} (${String(Date.now() - started)} ms)${detail ? ` — ${detail}` : ""}`);
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    results.push({ name, ok: false });
    console.log(`  FAIL  ${name} (${String(Date.now() - started)} ms) — ${message}`);
    if (currentPage && !currentPage.isClosed()) {
      const shot = path.join(ARTIFACTS, `p11-browser-failure-${String(Date.now())}.png`);
      await currentPage.screenshot({ path: shot as `${string}.png`, fullPage: true }).catch(() => undefined);
      console.log(`        at ${currentPage.url()}; screenshot ${shot}`);
    }
    return false;
  }
};

// ---------------------------------------------------------------- page helpers

interface PageOptions {
  /** The stored choice, or null for none. */
  choice: Theme | null;
  /** The device's prefers-color-scheme. */
  system: Theme;
  width?: number;
}

/**
 * The ONE signed-in context of the run. The operator signs in with a TOTP
 * code, and a code step is accepted once (A-115), so the suite signs in once
 * and opens every phase as a new tab of this context.
 */
let session: BrowserContext | null = null;

/** A new tab of the signed-in context whose first document starts with `choice` stored (or none) and `system` emulated. */
const newContextPage = async (_browser: Browser, o: PageOptions): Promise<{ context: { close: () => Promise<void> }; page: Page }> => {
  if (!session) throw new Error("not signed in");
  const page = await session.newPage();
  currentPage = page;
  await page.setViewport({ width: o.width ?? 1280, height: 900 });
  await page.evaluateOnNewDocument(
    (key: string, t: string) => {
      try {
        if (!sessionStorage.getItem("p11-seeded")) {
          if (t) localStorage.setItem(key, t);
          else localStorage.removeItem(key);
          sessionStorage.setItem("p11-seeded", "1");
        }
      } catch {
        /* storage blocked */
      }
    },
    STORAGE_KEY,
    o.choice ?? "",
  );
  await page.emulateMediaFeatures([
    { name: "prefers-color-scheme", value: o.system },
    { name: "prefers-reduced-motion", value: "reduce" },
  ]);
  return { context: { close: () => page.close() }, page };
};

const isDark = (page: Page): Promise<boolean> => page.evaluate(() => document.documentElement.classList.contains("dark"));

/** The background the page shows, as the browser computes it. */
const bodyBackground = (page: Page): Promise<string> =>
  page.evaluate(() => {
    const surface = document.querySelector<HTMLElement>('[data-surface="public"]') ?? document.body;
    return getComputedStyle(surface).backgroundColor;
  });

/** Wait until the page has rendered its <main><h1> and settled (bounded). */
const settle = async (page: Page): Promise<void> => {
  await page
    .waitForFunction(
      () =>
        [...document.querySelectorAll("main h1")].some((h) => {
          const r = h.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        }),
      { timeout: STEP_TIMEOUT },
    )
    .catch(() => {
      throw new Error(`${page.url()} never rendered a visible <h1> in <main>`);
    });
  await page.waitForNetworkIdle({ idleTime: 500, timeout: 6000 }).catch(() => undefined);
  await page
    .waitForFunction(() => !document.querySelector("main .animate-pulse, main [aria-busy='true']"), { timeout: 15000 })
    .catch(() => undefined);
  await sleep(1300);
};

const go = async (page: Page, route: string): Promise<void> => {
  await page.goto(`${FRONTEND_URL}${route}`, { waitUntil: "domcontentloaded", timeout: STEP_TIMEOUT });
  await settle(page);
};

const axe = async (page: Page, label: string, selector?: string): Promise<string> => {
  const has = await page.evaluate(() => typeof (window as unknown as { axe?: unknown }).axe !== "undefined");
  if (!has) await page.evaluate(AXE_SOURCE);
  const violations = await page.evaluate(async (sel: string | null) => {
    const w = window as unknown as {
      axe: {
        run: (
          ctx: Element | Document,
          o: unknown,
        ) => Promise<{ violations: { id: string; nodes: { target: string[]; failureSummary?: string }[] }[] }>;
      };
    };
    const ctx = sel ? document.querySelector(sel) ?? document : document;
    const res = await w.axe.run(ctx, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
      resultTypes: ["violations"],
    });
    return res.violations.map(
      (v) =>
        `${v.id} × ${String(v.nodes.length)}: ${v.nodes
          .slice(0, 3)
          .map((n) => `${n.target.join(" ")} (${(n.failureSummary ?? "").split("\n").slice(1).join("; ")})`)
          .join(" | ")}`,
    );
  }, selector ?? null);
  if (violations.length > 0) throw new Error(`axe (${label}): ${violations.join("; ")}`);
  return `${label}: axe 0`;
};

/** The harness's MFA state file for the operator on this stack (backend/src/tests/e2e/setup.js). */
const mfaStateFile = (): string =>
  process.env["E2E_MFA_STATE_FILE"] ??
  path.join(
    os.tmpdir(),
    `callibrator-e2e-mfa-${createHash("sha256").update(`${process.env["BASE_URL"] ?? ""}\n${api.OPERATOR.toLowerCase()}`).digest("hex").slice(0, 16)}.json`,
  );

const base32 = (secret: string): Buffer => {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of secret.replace(/=+$/, "").toUpperCase()) bits += alphabet.indexOf(ch).toString(2).padStart(5, "0");
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
};

/** RFC 6238 (SHA-1, 30 s, 6 digits) for a step the account has not used yet (as the harness's nextTotp). */
const nextTotp = async (): Promise<string> => {
  for (;;) {
    const file = mfaStateFile();
    const state = obj(JSON.parse(fs.readFileSync(file, "utf8")) as unknown);
    const secret = str(state["secret"]);
    if (!secret) throw new Error(`no TOTP secret in ${file}: run the harness sign-in first`);
    const now = Math.floor(Date.now() / 30000);
    const last = typeof state["lastStep"] === "number" ? state["lastStep"] : -1;
    const step = [now - 1, now, now + 1].find((x) => x > last);
    if (step !== undefined) {
      fs.writeFileSync(file, JSON.stringify({ ...state, lastStep: step }), { mode: 0o600 });
      const counter = Buffer.alloc(8);
      counter.writeBigUInt64BE(BigInt(step));
      const mac = createHmac("sha1", base32(secret)).update(counter).digest();
      const offset = (mac[mac.length - 1] ?? 0) & 0xf;
      const value =
        (((mac[offset] ?? 0) & 0x7f) << 24) | ((mac[offset + 1] ?? 0) << 16) | ((mac[offset + 2] ?? 0) << 8) | (mac[offset + 3] ?? 0);
      return String(value % 1000000).padStart(6, "0");
    }
    await sleep(30000 - (Date.now() % 30000) + 50);
  }
};

/** Sign in through the form (identifier first, then password, then the TOTP code when asked). */
const signIn = async (page: Page): Promise<void> => {
  await page.goto(`${FRONTEND_URL}/login`, { waitUntil: "networkidle2", timeout: STEP_TIMEOUT });
  await page.waitForSelector("#username", { timeout: STEP_TIMEOUT });
  await page.type("#username", api.OPERATOR);
  for (let attempt = 1; !(await page.$("#password")); attempt++) {
    await page.click('form:has(#username) button[type="submit"]');
    const shown = await page
      .waitForSelector("#password", { visible: true, timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    if (shown) break;
    if (attempt >= 3) throw new Error("the password step never appeared");
  }
  await page.type("#password", api.OPERATOR_PASSWORD);
  await page.click('form:has(#password) button[type="submit"]');
  const next = await Promise.race([
    page.waitForFunction(() => location.pathname.startsWith("/dashboard"), { timeout: 60000 }).then(() => "dashboard"),
    page.waitForSelector('input[autocomplete="one-time-code"]', { visible: true, timeout: 60000 }).then(() => "mfa"),
  ]).catch(() => "none");
  if (next === "mfa") {
    await page.type('input[autocomplete="one-time-code"]', await nextTotp());
    await page.click('form:has(input[autocomplete="one-time-code"]) button[type="submit"]');
  }
  await page.waitForFunction(() => location.pathname.startsWith("/dashboard"), { timeout: 60000 }).catch(async () => {
    const text = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 300)).catch(() => "");
    throw new Error(`sign-in did not reach /dashboard; the page says: ${text}`);
  });
  await settle(page);
};

const shot = async (page: Page, name: string, theme: Theme, width: number, fullPage = false): Promise<void> => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const file = path.join(SHOTS, `p11-${SHOT_TAG}-${name}-${theme}-${String(width)}.webp`);
  await page.screenshot({ path: file as `${string}.webp`, type: "webp", quality: 80, fullPage });
};

/** Click the first visible button in <main> whose accessible text matches. */
const clickButton = async (page: Page, pattern: RegExp, scope = "main"): Promise<void> => {
  const handles = await page.$$(`${scope} button, ${scope} a[role="button"]`);
  for (const h of handles) {
    const label = await h.evaluate((el) => `${el.getAttribute("aria-label") ?? ""} ${el.textContent ?? ""}`.trim());
    const visible = await h.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    if (visible && pattern.test(label)) {
      await h.click();
      return;
    }
  }
  throw new Error(`no visible button matching ${String(pattern)} in ${scope}`);
};

const dialogOpen = (page: Page): Promise<unknown> =>
  page.waitForSelector('[role="dialog"], [role="alertdialog"]', { visible: true, timeout: STEP_TIMEOUT });

// ---------------------------------------------------------------- checks

const continuity = async (browser: Browser): Promise<void> => {
  // a. no choice, dark device → both surfaces dark, from the first frame.
  {
    const { context, page } = await newContextPage(browser, { choice: null, system: "dark" });
    try {
      await page.evaluateOnNewDocument(() => {
        requestAnimationFrame(() => {
          (window as unknown as { __p11FirstFrameDark?: boolean }).__p11FirstFrameDark =
            document.documentElement.classList.contains("dark");
        });
      });
      await check("continuity a: no choice + dark device → the landing is dark", async () => {
        await page.goto(`${FRONTEND_URL}/`, { waitUntil: "domcontentloaded", timeout: STEP_TIMEOUT });
        await sleep(500);
        const bg = await bodyBackground(page);
        if (bg !== "rgb(26, 21, 17)") throw new Error(`the landing's background is ${bg}, not the dark #1A1511`);
        return `background ${bg}`;
      });
      await check("continuity a: no choice + dark device → the dashboard is dark at the first frame", async () => {
        await page.goto(`${FRONTEND_URL}/dashboard`, { waitUntil: "domcontentloaded", timeout: STEP_TIMEOUT });
        await settle(page);
        const first = await page.evaluate(() => (window as unknown as { __p11FirstFrameDark?: boolean }).__p11FirstFrameDark);
        if (first !== true) throw new Error(`at the first frame .dark was ${String(first)} (a flash of light)`);
        if (!(await isDark(page))) throw new Error("the dashboard is not dark");
        const stored = await page.evaluate((k: string) => localStorage.getItem(k), STORAGE_KEY);
        if (stored !== null) throw new Error(`a choice was stored without the user choosing: ${stored}`);
        return "dark at the first frame, nothing stored";
      });
    } finally {
      await context.close();
    }
  }

  // b. choose dark on the landing → the dashboard is dark (light device).
  {
    const { context, page } = await newContextPage(browser, { choice: null, system: "light" });
    try {
      await check("continuity b: dark chosen on the landing → the dashboard is dark", async () => {
        await page.goto(`${FRONTEND_URL}/`, { waitUntil: "networkidle2", timeout: STEP_TIMEOUT });
        if (await isDark(page)) throw new Error("the landing started dark on a light device with no choice");
        await page.click("header button[aria-pressed]");
        await page.waitForFunction(() => document.documentElement.classList.contains("dark"), { timeout: 5000 });
        await go(page, "/dashboard");
        if (!(await isDark(page))) throw new Error("the dashboard is light after choosing dark on the landing");
        const pressed = await page.$eval('header button[aria-pressed]', (b) => b.getAttribute("aria-pressed"));
        if (pressed !== "true") throw new Error(`the dashboard toggle says aria-pressed=${String(pressed)}`);
        return "dark carried, toggle pressed";
      });

      // c. choose light in the dashboard (dark device) → the public surface is light.
      // ADR-131 (P10-18): the public pages are another root layout, so going from
      // the dashboard to `/` is a full document load (it used to be a client
      // navigation into the same document, which this check probed). The choice
      // must survive that load: it is applied before first paint from storage.
      await check("continuity c: light chosen in the dashboard → the public surface is light after the cross-layout load (D9)", async () => {
        await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "dark" }]);
        await page.click('header button[aria-pressed="true"]');
        await page.waitForFunction(() => !document.documentElement.classList.contains("dark"), { timeout: 5000 });
        const choice = await page.evaluate(() => document.documentElement.getAttribute("data-theme-choice"));
        if (choice !== "light") throw new Error(`data-theme-choice is ${String(choice)} after choosing light (D9)`);
        await page.goto(`${FRONTEND_URL}/`, { waitUntil: "networkidle2", timeout: STEP_TIMEOUT });
        const landing = await bodyBackground(page);
        if (landing !== "rgb(251, 247, 240)") throw new Error(`the landing is ${landing} after choosing light`);
        if (await isDark(page)) throw new Error("<html> is dark on the landing after choosing light");
        const landed = await page.evaluate(() => document.documentElement.getAttribute("data-theme-choice"));
        if (landed !== "light") throw new Error(`the landing's data-theme-choice is ${String(landed)}`);
        return "light carried to the public surface on a dark device, across the root-layout boundary";
      });

      // d. "Use device setting" clears the choice.
      await check('continuity d: "Use device setting" returns both surfaces to the device', async () => {
        await go(page, "/dashboard/profile");
        await clickButton(page, /use device setting/i);
        await page.waitForFunction(() => document.documentElement.classList.contains("dark"), { timeout: 5000 });
        const state = await page.evaluate((k: string) => ({
          stored: localStorage.getItem(k),
          attr: document.documentElement.getAttribute("data-theme-choice"),
        }), STORAGE_KEY);
        if (state.stored !== null || state.attr !== null) throw new Error(`choice not cleared: ${JSON.stringify(state)}`);
        await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }]);
        await page.waitForFunction(() => !document.documentElement.classList.contains("dark"), { timeout: 5000 });
        return "cleared; follows a live device change";
      });
    } finally {
      await context.close();
    }
  }
};

const axeSweep = async (browser: Browser): Promise<void> => {
  for (const theme of THEMES) {
    for (const width of WIDTHS) {
      const { context, page } = await newContextPage(browser, { choice: theme, system: theme, width });
      try {
        for (const route of AXE_PAGES) {
          await check(`axe [${theme} ${String(width)}] ${route}`, async () => {
            await go(page, route);
            if ((await isDark(page)) !== (theme === "dark")) throw new Error(`not in the ${theme} theme`);
            return axe(page, `${theme} ${String(width)} ${route}`);
          });
        }
      } finally {
        await context.close();
      }
    }
  }
};

const states = async (browser: Browser, tenantId: string): Promise<void> => {
  for (const theme of THEMES) {
    const { context, page } = await newContextPage(browser, { choice: theme, system: theme });
    try {
      await check(`states [${theme}] D1: the tenant backup "Create Backup" dialog`, async () => {
        await go(page, `/dashboard/tenants/${tenantId}/backup`);
        await clickButton(page, /create backup/i);
        await dialogOpen(page);
        await sleep(500);
        if (SHOTS_ON) await shot(page, "backup-create-dialog", theme, 1280);
        const detail = await axe(page, `${theme} backup dialog`, '[role="dialog"]');
        await page.keyboard.press("Escape");
        return detail;
      });
      await check(`states [${theme}] D2: the SAML SSO panel`, async () => {
        await go(page, "/dashboard/tenants");
        await clickButton(page, /configure saml sso/i);
        await dialogOpen(page);
        await sleep(500);
        if (SHOTS_ON) await shot(page, "sso-panel", theme, 1280);
        const detail = await axe(page, `${theme} SSO panel`, '[role="dialog"]');
        await page.keyboard.press("Escape");
        return detail;
      });
      await check(`states [${theme}] D7: the notification panel`, async () => {
        await go(page, "/dashboard");
        await clickButton(page, /notification/i, "header");
        await sleep(600);
        if (SHOTS_ON) await shot(page, "notifications-open", theme, 1280);
        return axe(page, `${theme} notifications open`);
      });
      await check(`states [${theme}] a create dialog: add a device`, async () => {
        await go(page, "/dashboard/devices");
        await clickButton(page, /^(add|new|create|register)\b/i);
        await dialogOpen(page);
        await sleep(500);
        if (SHOTS_ON) await shot(page, "devices-create-dialog", theme, 1280);
        const detail = await axe(page, `${theme} add device`, '[role="dialog"]');
        await page.keyboard.press("Escape");
        return detail;
      });
    } finally {
      await context.close();
    }
  }
};


/** Key pages, both themes, desktop; the shell at 360 closed and open. */
const shots = async (browser: Browser): Promise<void> => {
  const pages: [string, string][] = [
    ["home", "/dashboard"],
    ["devices", "/dashboard/devices"],
    ["calibration", "/dashboard/calibration"],
    ["maintenance", "/dashboard/maintenance"],
    ["users", "/dashboard/users"],
    ["vendors", "/dashboard/vendors"],
    ["tenants", "/dashboard/tenants"],
    ["kanban", "/dashboard/kanban"],
    ["profile", "/dashboard/profile"],
  ];
  for (const theme of THEMES) {
    const { context, page } = await newContextPage(browser, { choice: theme, system: theme });
    try {
      for (const [name, route] of pages) {
        await check(`shot [${theme}] ${name}`, async () => {
          await go(page, route);
          await shot(page, name, theme, 1280);
          return "";
        });
      }
    } finally {
      await context.close();
    }
    const mobile = await newContextPage(browser, { choice: theme, system: theme, width: 360 });
    try {
      await check(`shot [${theme}] the shell at 360, closed and open`, async () => {
        await go(mobile.page, "/dashboard");
        await shot(mobile.page, "shell-closed", theme, 360);
        await mobile.page.click('button[aria-label="Open navigation"]');
        await sleep(500);
        await shot(mobile.page, "shell-open", theme, 360);
        return "";
      });
    } finally {
      await mobile.context.close();
    }
  }
};

// ---------------------------------------------------------------- main

const main = async (): Promise<void> => {
  const started = Date.now();
  console.log(`P11 browser suite — ${FRONTEND_URL} (${ONLY.join(", ")})`);
  const login = await api.httpPost("/auth/login", { user: api.OPERATOR, password: api.OPERATOR_PASSWORD });
  const token = api.extractToken(login.body);
  if (login.status !== 200 || !token) throw new Error(`the operator could not sign in (${String(login.status)})`);
  const admin = api.authHeader(token);
  const tenantId = str(obj(obj(login.body)["data"])["tenantId"]);

  // Four devices, one per status, so the device list shows the status set.
  const stamp = Date.now().toString(36);
  const deviceIds: string[] = [];
  for (const status of ["active", "maintenance", "inactive", "retired"]) {
    const r = await api.httpPost(
      "/calibration-devices",
      { name: `P11 ${status} ${stamp}`, manufacturer: "P11", model: "T-1", serialNumber: `P11-${status}-${stamp}`, status },
      admin,
    );
    const id = str(obj(obj(r.body)["data"])["id"]);
    if (r.status === 201 && id) deviceIds.push(id);
  }

  const browser = await puppeteer.launch({
    executablePath: chromePath(),
    headless: process.env["HEADFUL"] ? false : true,
    args: ["--no-first-run", "--no-default-browser-check"],
  });
  try {
    session = await browser.createBrowserContext();
    const first = await session.newPage();
    currentPage = first;
    await first.setViewport({ width: 1280, height: 900 });
    await signIn(first);
    await first.close();
    if (ONLY.includes("continuity")) await continuity(browser);
    if (ONLY.includes("states") || SHOTS_ON) await states(browser, tenantId);
    if (SHOTS_ON) await shots(browser);
    if (ONLY.includes("axe")) await axeSweep(browser);
  } finally {
    await browser.close();
    for (const id of deviceIds) await api.httpDelete(`/calibration-devices/${id}`, admin).catch(() => undefined);
  }

  const passed = results.filter((r) => r.ok).length;
  const ok = results.length > 0 && passed === results.length;
  console.log(`\n${String(passed)}/${String(results.length)} checks passed in ${String(Date.now() - started)} ms${ok ? "" : " — FAILED"}`);
  process.exit(ok ? 0 : 1);
};

main().catch((err: unknown) => {
  console.error(`P11 browser suite could not run: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
});
