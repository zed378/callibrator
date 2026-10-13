#!/usr/bin/env node
/**
 * P22 browser coverage (2026-10-13) — the Phase 22 dashboard pages that were "done in code" but had
 * never run in a browser, each through its main flow against a RUNNING, seeded stack
 * (deploy/compose/docker-compose.e2e.yml, built from the tree under test):
 *
 *   P22-09  /dashboard/client-facilities   a tenant administrator adds a facility through the form.
 *   P22-01  /dashboard/ipm-templates        the operator adds a device type, creates its checklist,
 *                                           opens a draft, adds a library item, saves, writes the
 *                                           change note and publishes (version 1 in the history;
 *                                           the published catalogue shows the type).
 *   P22-02  /dashboard/devices              the administrator registers a device of that type in the
 *                                           facility (room + floor), then adds both required photos
 *                                           (JPEG files through the file inputs); "Finish" turns on;
 *                                           the row shows the thumbnail served by a signed link.
 *   P22-03  /dashboard/ipm/new, /capture    the QR typed → the device's facts → Start → every item
 *                                           answered → the outcome and recommendation → Submit.
 *   P22-04  /dashboard/ipm (+ the report)   the history finds the visit by QR; the visit dialog shows
 *                                           it and links the report; the report page renders and
 *                                           its PDF download produces a file (%PDF).
 *   P22-05  /dashboard/calibration-dates    the quick entry by typed QR (typed laboratory, certificate
 *                                           number) → saved; the calibration list shows the record.
 *   P22-06  /dashboard/exports              the inventory XLSX and the latest-calibration recap XLSX:
 *                                           size first, then built IN THE BROWSER; each file is
 *                                           unzipped and must hold the device's QR.
 *   P22-07  /dashboard                      the condition panel (donut named, a "Good" drill-down to
 *                                           the filtered device list holding the device), the IPM
 *                                           figures and the technician activity naming the visit.
 *   P22-08  /d/<token> (public)             the row action "Public link of …" issues a link; the tenant
 *                                           turns the page on (PATCH /tenants/settings "minimal"); signed
 *                                           out, the page shows type, make, model, facility and the
 *                                           calibration/IPM facts and never the serial, QR number, room, a
 *                                           photo, a document or a name; revoked, it says "No device
 *                                           answers to this link." (every outcome is HTTP 200, ADR-138
 *                                           Am. 3: the content is asserted). Axe light/dark and the layout
 *                                           check on both states; the setting is restored afterwards.
 *   axe     every page above, light AND dark (WCAG 2.1 A/AA: 0), the capture and the report with data,
 *           and the dialogs the flows open (device form, photos, facility form, the visit).
 *   layout  every page above at 360, 768 and 1280 px and at 200 % zoom: no sideways page scroll,
 *           exactly one <main> and one <h1> (the dashboard sibling of responsive.browser.js, whose
 *           pages are signed out).
 *
 * Data: synthetic, created per run (a stamp in every name), so two runs back to back never share a
 * row. The operator works only the catalogue (every catalogue write is the platform operator's); a
 * tenant administrator (HEALTHCARE ADMIN, the operator's tenant, created through the API with its
 * one-time password replaced, A-123) works everything else — the operator may not author tenant
 * records (A-127). Both sign in through the form (TOTP when the tenant asks, as the harness does).
 * The pages run in English (the `locale` cookie): the strings asserted are the `en` dictionary's.
 *
 *   FRONTEND_URL=http://localhost:27411 BASE_URL=http://127.0.0.1:27410 \
 *   E2E_OPERATOR_PASSWORD=… [E2E_BOOTSTRAP_PASSWORD=…] node automate/p22.browser.mts
 *
 * Environment: CHROME_PATH, HEADFUL=1, P22_ARTIFACTS=<dir> (failure screenshots and the downloads).
 * Nothing is skipped: every check runs on every run. Exit 0 only when every check passed.
 * Not part of `make verify`; part of `make test-browser`.
 */
import { createRequire } from "node:module";
import { createHash, createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import puppeteer from "puppeteer-core";
import type { Browser, BrowserContext, ElementHandle, Page } from "puppeteer-core";
import { strFromU8, unzipSync } from "fflate";

const require = createRequire(import.meta.url);
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));

const FRONTEND_URL = (process.env["FRONTEND_URL"] ?? "http://localhost:3001").replace(/\/$/, "");
process.env["BASE_URL"] = process.env["BASE_URL"] ?? "http://localhost:3000";
const STEP_TIMEOUT = 30000;
const ARTIFACTS = process.env["P22_ARTIFACTS"] ?? path.join(os.tmpdir(), "p22-browser");

interface Reply {
  status: number;
  body: unknown;
}
interface Harness {
  OPERATOR: string;
  OPERATOR_PASSWORD: string;
  API_BASE: string;
  defaultHeaders: Record<string, string>;
  httpGet: (path: string, headers?: Record<string, string>) => Promise<Reply>;
  httpPost: (path: string, body: unknown, headers?: Record<string, string>) => Promise<Reply>;
  httpDelete: (path: string, headers?: Record<string, string>) => Promise<Reply>;
  extractToken: (body: unknown) => string | null;
  authHeader: (token: string | null) => Record<string, string>;
}
const api = require(path.join(here, "../backend/src/tests/e2e/setup.js")) as Harness;
const AXE_SOURCE = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

type Theme = "light" | "dark";
const THEMES: Theme[] = ["light", "dark"];

const obj = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

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
      fs.mkdirSync(ARTIFACTS, { recursive: true });
      const shot = path.join(ARTIFACTS, `p22-browser-failure-${String(Date.now())}.png`);
      await currentPage.screenshot({ path: shot as `${string}.png`, fullPage: true }).catch(() => undefined);
      const text = await currentPage
        .evaluate(() => (document.querySelector('[role="dialog"]') ?? document.querySelector("main") ?? document.body).textContent?.replace(/\s+/g, " ").slice(0, 1200) ?? "")
        .catch(() => "");
      console.log(`        at ${currentPage.url()}; screenshot ${shot}; the page says: ${text}`);
    }
    return false;
  }
};

/** A step the next ones need: a failure stops the run (its dependants could only fail). */
const must = async (name: string, fn: () => Promise<string>): Promise<void> => {
  if (!(await check(name, fn))) throw new Error(`stopped after "${name}"`);
};

// ---------------------------------------------------------------- API setup (synthetic data)

const ok = (r: Reply, what: string): unknown => {
  if (r.status < 200 || r.status >= 300) throw new Error(`${what}: ${String(r.status)} ${JSON.stringify(r.body).slice(0, 300)}`);
  return obj(r.body)["data"];
};

interface Account {
  id: string;
  username: string;
  password: string;
}

const operatorAuth = async (): Promise<Record<string, string>> => {
  const login = await api.httpPost("/auth/login", { user: api.OPERATOR, password: api.OPERATOR_PASSWORD });
  const token = api.extractToken(login.body);
  if (!token) throw new Error(`the operator could not sign in (${String(login.status)})`);
  return api.authHeader(token);
};

/** A HEALTHCARE ADMIN of the operator's tenant, its one-time password replaced (A-123). */
const tenantAdmin = async (auth: Record<string, string>, stamp: string): Promise<Account> => {
  const tenantId = str(obj(ok(await api.httpPost("/auth/verify", {}, auth), "verify"))["tenantId"]);
  const roles = arr(ok(await api.httpGet("/roles?limit=100", auth), "roles")).map(obj);
  const role = roles.find((r) => /^healthcare admin$/i.test(str(r["name"])));
  if (!role) throw new Error("no HEALTHCARE ADMIN role on this stack");
  const username = `p22adm${stamp}`.slice(0, 20);
  const oneTime = `Tmp${stamp}Aa1!`;
  const created = obj(
    ok(
      await api.httpPost(
        "/users/create",
        { username, firstName: "P22", lastName: "Administrator", email: `${username}@e2e.test`, password: oneTime, roleId: str(role["id"]), tenantId },
        auth,
      ),
      "user create",
    ),
  );
  const first = await api.httpPost("/auth/login", { user: username, password: oneTime });
  const firstToken = str(obj(first.body)["token"]);
  if (!firstToken) throw new Error(`the administrator's first sign-in gave no token (${String(first.status)})`);
  const password = `P22${stamp}Zz9!`;
  ok(await api.httpPost("/auth/first-sign-in/password", { token: firstToken, newPassword: password }), "first-sign-in password");
  // Through the harness: it enrols MFA when the tenant requires it and keeps the secret in its state file.
  await api.httpPost("/auth/login", { user: username, password });
  return { id: str(created["id"]), username, password };
};

// ---------------------------------------------------------------- sign-in (TOTP as the harness)

const mfaStateFile = (identifier: string): string =>
  path.join(os.tmpdir(), `callibrator-e2e-mfa-${createHash("sha256").update(`${process.env["BASE_URL"] ?? ""}\n${identifier.toLowerCase()}`).digest("hex").slice(0, 16)}.json`);

const base32 = (secret: string): Buffer => {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const ch of secret.replace(/=+$/, "").toUpperCase()) bits += alphabet.indexOf(ch).toString(2).padStart(5, "0");
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
};

/** RFC 6238 for a step this account has not used (the harness's state file is shared; A-115). */
const nextTotp = async (identifier: string): Promise<string> => {
  for (;;) {
    const file = mfaStateFile(identifier);
    const state = obj(JSON.parse(fs.readFileSync(file, "utf8")) as unknown);
    const secret = str(state["secret"]);
    if (!secret) throw new Error(`no TOTP secret in ${file}`);
    const now = Math.floor(Date.now() / 30000);
    const last = typeof state["lastStep"] === "number" ? state["lastStep"] : -1;
    const step = [now - 1, now, now + 1].find((x) => x > last);
    if (step !== undefined) {
      fs.writeFileSync(file, JSON.stringify({ ...state, lastStep: step }), { mode: 0o600 });
      const counter = Buffer.alloc(8);
      counter.writeBigUInt64BE(BigInt(step));
      const mac = createHmac("sha1", base32(secret)).update(counter).digest();
      const offset = (mac[mac.length - 1] ?? 0) & 0xf;
      const value = (((mac[offset] ?? 0) & 0x7f) << 24) | ((mac[offset + 1] ?? 0) << 16) | ((mac[offset + 2] ?? 0) << 8) | (mac[offset + 3] ?? 0);
      return String(value % 1000000).padStart(6, "0");
    }
    await sleep(30000 - (Date.now() % 30000) + 50);
  }
};

const signIn = async (page: Page, user: string, password: string): Promise<void> => {
  await page.goto(`${FRONTEND_URL}/login`, { waitUntil: "networkidle2", timeout: STEP_TIMEOUT });
  await page.waitForSelector("#username", { timeout: STEP_TIMEOUT });
  await page.type("#username", user);
  for (let attempt = 1; !(await page.$("#password")); attempt++) {
    await page.click('form:has(#username) button[type="submit"]');
    const shown = await page
      .waitForSelector("#password", { visible: true, timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    if (shown) break;
    if (attempt >= 3) throw new Error("the password step never appeared");
  }
  await page.type("#password", password);
  await page.click('form:has(#password) button[type="submit"]');
  const next = await Promise.race([
    page.waitForFunction(() => location.pathname.startsWith("/dashboard"), { timeout: 60000 }).then(() => "dashboard"),
    page.waitForSelector('input[autocomplete="one-time-code"]', { visible: true, timeout: 60000 }).then(() => "mfa"),
  ]).catch(() => "none");
  if (next === "mfa") {
    await page.type('input[autocomplete="one-time-code"]', await nextTotp(user));
    await page.click('form:has(input[autocomplete="one-time-code"]) button[type="submit"]');
  }
  await page.waitForFunction(() => location.pathname.startsWith("/dashboard"), { timeout: 60000 }).catch(async () => {
    const text = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 300)).catch(() => "");
    throw new Error(`sign-in did not reach /dashboard; the page says: ${text}`);
  });
};

// ---------------------------------------------------------------- page helpers

/** A signed-in browser context in English, with downloads landing in `downloads`. */
interface Session {
  context: BrowserContext;
  downloads: string;
}

const openSession = async (browser: Browser, who: Account, label: string): Promise<Session> => {
  const context = await browser.createBrowserContext();
  const downloads = path.join(ARTIFACTS, `downloads-${label}-${String(Date.now())}`);
  fs.mkdirSync(downloads, { recursive: true });
  const cdp = await browser.target().createCDPSession();
  await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: downloads, browserContextId: context.id ?? "", eventsEnabled: false });
  const page = await newTab({ context, downloads }, "light");
  await signIn(page, who.username, who.password);
  await page.close();
  return { context, downloads };
};

/** A new tab of the session, in `theme`, reduced motion, at `width`. */
const newTab = async (s: Session, theme: Theme, width = 1280, height = 900, scale = 1): Promise<Page> => {
  const page = await s.context.newPage();
  currentPage = page;
  await page.setViewport({ width, height, deviceScaleFactor: scale });
  const host = new URL(FRONTEND_URL).hostname;
  await s.context.setCookie({ name: "locale", value: "en", domain: host, path: "/" });
  await page.evaluateOnNewDocument((t: string) => {
    try {
      localStorage.setItem("hdc-theme-preference", t);
    } catch {
      /* storage blocked */
    }
  }, theme);
  await page.emulateMediaFeatures([
    { name: "prefers-color-scheme", value: theme },
    { name: "prefers-reduced-motion", value: "reduce" },
  ]);
  return page;
};

/** Wait until <main> holds a visible <h1> and the page has settled (no busy marker; bounded). */
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
  await page.waitForNetworkIdle({ idleTime: 400, timeout: 8000 }).catch(() => undefined);
  await page.waitForFunction(() => !document.querySelector("main .animate-pulse, main [aria-busy='true']"), { timeout: 15000 }).catch(() => undefined);
};

const go = async (page: Page, route: string): Promise<void> => {
  await page.goto(`${FRONTEND_URL}${route}`, { waitUntil: "domcontentloaded", timeout: STEP_TIMEOUT });
  await settle(page);
  if (!new URL(page.url()).pathname.startsWith(route.split("?")[0] ?? route)) throw new Error(`asked for ${route}, landed on ${page.url()}`);
};

/** Wait for `pattern` in the text of `scope` (the last match of the selector, e.g. the newest dialog). */
const waitText = async (page: Page, pattern: RegExp, scope = "main", timeout = STEP_TIMEOUT): Promise<void> => {
  await page
    .waitForFunction(
      (src: string, flags: string, sel: string) => {
        // Visible ones only: Next keeps a route it navigated away from mounted and hidden.
        const nodes = [...document.querySelectorAll(sel)].filter((n) => n.getClientRects().length > 0);
        const el = nodes[nodes.length - 1];
        return !!el && new RegExp(src, flags).test((el as HTMLElement).innerText ?? "");
      },
      { timeout },
      pattern.source,
      pattern.flags,
      scope,
    )
    .catch(async () => {
      const said = await page.evaluate((sel: string) => {
        const nodes = [...document.querySelectorAll(sel)].filter((n) => n.getClientRects().length > 0);
        return ((nodes[nodes.length - 1] as HTMLElement | undefined)?.innerText ?? "(none)").replace(/\s+/g, " ").slice(0, 600);
      }, scope);
      throw new Error(`${String(pattern)} never appeared in ${scope}; it says: ${said}`);
    });
};

/** The first visible, enabled control in `scope` (button, link, tab) whose accessible name matches. */
const control = async (page: Page, pattern: RegExp, scope = "main", timeout = STEP_TIMEOUT): Promise<ElementHandle<Element>> => {
  const deadline = Date.now() + timeout;
  for (;;) {
    const scopes = scope.split(",").map((s) => s.trim());
    const handles = await page.$$(scopes.flatMap((s) => [`${s} button`, `${s} a[href]`, `${s} [role="tab"]`]).join(", "));
    for (const h of handles) {
      const hit = await h.evaluate(
        (el: Element, src: string, flags: string) => {
          const name = `${el.getAttribute("aria-label") ?? ""} ${(el as HTMLElement).innerText ?? el.textContent ?? ""}`.replace(/\s+/g, " ").trim();
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && !(el as HTMLButtonElement).disabled && el.getAttribute("aria-disabled") !== "true" && new RegExp(src, flags).test(name);
        },
        pattern.source,
        pattern.flags,
      );
      if (hit) return h;
    }
    if (Date.now() > deadline) throw new Error(`no visible, enabled control matching ${String(pattern)} in ${scope}`);
    await sleep(200);
  }
};

const click = async (page: Page, pattern: RegExp, scope = "main", timeout = STEP_TIMEOUT): Promise<void> => {
  const h = await control(page, pattern, scope, timeout);
  await h.evaluate((el: Element) => el.scrollIntoView({ block: "center" }));
  await h.click();
};

/** Replace a text field's value as a person would (select all, type). */
const fill = async (page: Page, selector: string, value: string): Promise<void> => {
  const el = await page.waitForSelector(selector, { visible: true, timeout: STEP_TIMEOUT });
  if (!el) throw new Error(`no ${selector}`);
  await el.click();
  await page.keyboard.down("Control");
  await page.keyboard.press("A");
  await page.keyboard.up("Control");
  await page.keyboard.press("Backspace");
  if (value) await el.type(value);
};

/** Choose the option of `selector` whose text matches (waits for it to be offered). */
const choose = async (page: Page, selector: string, pattern: RegExp): Promise<string> => {
  const handle = await page
    .waitForFunction(
      (sel: string, src: string, flags: string) => {
        const s = document.querySelector<HTMLSelectElement>(sel);
        const o = s ? [...s.options].find((x) => new RegExp(src, flags).test(x.textContent ?? "")) : undefined;
        return o ? o.value : null;
      },
      { timeout: STEP_TIMEOUT },
      selector,
      pattern.source,
      pattern.flags,
    )
    .catch(async () => {
      const offered = await page.evaluate((sel: string) => [...(document.querySelector<HTMLSelectElement>(sel)?.options ?? [])].map((o) => o.textContent).join(" | "), selector);
      throw new Error(`${selector} never offered ${String(pattern)} (offers: ${offered})`);
    });
  const value = String(await handle.jsonValue());
  await page.select(selector, value);
  return value;
};

const dialog = '[role="dialog"], [role="alertdialog"]';
const dialogOpen = async (page: Page): Promise<void> => {
  await page.waitForSelector(dialog, { visible: true, timeout: STEP_TIMEOUT });
};
const dialogsClosed = async (page: Page): Promise<void> => {
  await page.waitForFunction((sel: string) => document.querySelectorAll(sel).length === 0, { timeout: STEP_TIMEOUT }, dialog);
};

const axe = async (page: Page, label: string, selector?: string): Promise<string> => {
  // Measure the settled page: a control that just changed state (Previous, enabled after a disabled
  // step) fades over its 200 ms transition, and a colour sampled mid-fade is not the page's colour.
  // Infinite animations (a spinner) are left out: they never finish.
  await page
    .waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running" || a.effect?.getComputedTiming().iterations === Infinity), { timeout: 5000 })
    .catch(() => undefined);
  const has = await page.evaluate(() => typeof (window as unknown as { axe?: unknown }).axe !== "undefined");
  if (!has) await page.evaluate(AXE_SOURCE);
  const violations = await page.evaluate(async (sel: string | null) => {
    const w = window as unknown as {
      axe: { run: (ctx: Element | Document, o: unknown) => Promise<{ violations: { id: string; nodes: { target: string[]; failureSummary?: string }[] }[] }> };
    };
    const nodes = sel ? [...document.querySelectorAll(sel)] : [];
    const ctx = nodes[nodes.length - 1] ?? document;
    const res = await w.axe.run(ctx, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] }, resultTypes: ["violations"] });
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

/** A file the browser downloaded into `dir` after `since`, with `ext`, complete (no .crdownload). */
const downloaded = async (dir: string, ext: string, since: Set<string>, timeout = 60000): Promise<string> => {
  const deadline = Date.now() + timeout;
  for (;;) {
    const names = fs.readdirSync(dir);
    const fresh = names.filter((n) => !since.has(n) && n.toLowerCase().endsWith(ext));
    if (fresh.length > 0 && !names.some((n) => n.endsWith(".crdownload"))) {
      const file = path.join(dir, fresh[0] ?? "");
      if (fs.statSync(file).size > 0) return file;
    }
    if (Date.now() > deadline) throw new Error(`no ${ext} file arrived in ${dir} (it holds: ${names.join(", ") || "nothing"})`);
    await sleep(250);
  }
};

/** Every sheet XML of an XLSX file, joined (the writer uses inline strings, so values are in the sheets). */
const xlsxText = (file: string): string => {
  const bytes = fs.readFileSync(file);
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error(`${path.basename(file)} is not a zip (an XLSX is one)`);
  const parts = unzipSync(new Uint8Array(bytes));
  const sheets = Object.keys(parts).filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k));
  if (sheets.length === 0) throw new Error(`${path.basename(file)} has no worksheet (parts: ${Object.keys(parts).join(", ")})`);
  return sheets.map((k) => strFromU8(parts[k] ?? new Uint8Array())).join("\n");
};

/** A real JPEG (the browser's own encoder) of `w`×`h`, written to the artifacts directory. */
const makeJpeg = async (page: Page, name: string, hue: number): Promise<string> => {
  const dataUrl = await page.evaluate((h: number) => {
    const c = document.createElement("canvas");
    c.width = 1200;
    c.height = 900;
    const g = c.getContext("2d");
    if (!g) return "";
    g.fillStyle = `hsl(${String(h)} 60% 50%)`;
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = "#fff";
    g.font = "64px sans-serif";
    g.fillText("P22 synthetic photo", 80, 450);
    return c.toDataURL("image/jpeg", 0.9);
  }, hue);
  if (!dataUrl.startsWith("data:image/jpeg;base64,")) throw new Error("the browser could not encode a JPEG");
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  const file = path.join(ARTIFACTS, name);
  fs.writeFileSync(file, Buffer.from(dataUrl.slice("data:image/jpeg;base64,".length), "base64"));
  return file;
};

/**
 * Answers every item of the open capture the simplest valid way: "not applicable" where the item
 * offers it, the first outcome of each choice group not yet pressed, a plausible reading (25) where a
 * number is needed, and a short text in a free-text item. The base set of the standard is in every
 * published checklist; this completes the form, it is not what the suite measures.
 */
const answerAll = async (page: Page): Promise<number> => {
  const steps = await page.$$eval("main nav[aria-label] button", (bs) => bs.length);
  let answered = 0;
  for (let i = 0; i < steps - 2; i++) {
    const buttons = await page.$$("main nav[aria-label] button");
    await buttons[i]?.click();
    await page.waitForFunction((n: number) => document.querySelectorAll("main nav[aria-label] button")[n]?.getAttribute("aria-current") === "step", { timeout: 5000 }, i);
    answered += await page.evaluate(async () => {
      const pause = () => new Promise((r) => setTimeout(r, 40));
      let n = 0;
      for (const box of [...document.querySelectorAll<HTMLInputElement>("main input[type=checkbox]")]) {
        if (!box.checked && /Not applicable/.test(box.parentElement?.textContent ?? "")) {
          box.click();
          n += 1;
          await pause();
        }
      }
      for (const group of [...document.querySelectorAll("main [role=group]")]) {
        if (group.closest("form[action], [data-language-toggle]") || group.querySelector('button[aria-pressed="true"]')) continue;
        const first = group.querySelector<HTMLButtonElement>("button[aria-pressed]:not([disabled])");
        if (first) {
          first.click();
          n += 1;
          await pause();
        }
      }
      return n;
    });
    for (const input of await page.$$('main input[inputmode="decimal"]')) {
      if (await input.evaluate((el) => (el as HTMLInputElement).value === "" && !(el as HTMLInputElement).disabled)) {
        await input.type("25");
        answered += 1;
      }
    }
    for (const area of await page.$$('main textarea[id$="-text"]')) {
      if (await area.evaluate((el) => (el as HTMLTextAreaElement).value === "")) {
        await area.type("ok");
        answered += 1;
      }
    }
    // A reading against a limit that is not determinate asks a person: the group appears after typing.
    answered += await page.evaluate(() => {
      let n = 0;
      for (const group of [...document.querySelectorAll("main [role=group]")]) {
        if (group.querySelector('button[aria-pressed="true"]')) continue;
        const first = group.querySelector<HTMLButtonElement>("button[aria-pressed]:not([disabled])");
        if (first) {
          first.click();
          n += 1;
        }
      }
      return n;
    });
  }
  return answered;
};

/** No sideways page scroll; exactly one <main> and one <h1>. */
const layout = async (page: Page): Promise<string> => {
  const m = await page.evaluate(() => {
    const de = document.documentElement;
    const wide = [...document.body.querySelectorAll("*")]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.right <= de.clientWidth + 1) return false;
        // Inside a container that scrolls by itself (a wide table) is allowed.
        for (let p = el.parentElement; p; p = p.parentElement) {
          const o = getComputedStyle(p).overflowX;
          if (o === "auto" || o === "scroll" || o === "hidden") return false;
        }
        return true;
      })
      .slice(0, 4)
      .map((el) => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}.${String(el.className).split(" ").slice(0, 3).join(".")} right=${String(Math.round(el.getBoundingClientRect().right))}`);
    return { sw: de.scrollWidth, cw: de.clientWidth, mains: document.querySelectorAll("main").length, h1s: document.querySelectorAll("h1").length, wide };
  });
  const problems: string[] = [];
  if (m.sw > m.cw) problems.push(`scrolls sideways ${String(m.sw)}/${String(m.cw)} (${m.wide.join("; ")})`);
  if (m.mains !== 1) problems.push(`${String(m.mains)} <main>`);
  if (m.h1s !== 1) problems.push(`${String(m.h1s)} <h1>`);
  if (problems.length > 0) throw new Error(problems.join("; "));
  return `scroll ${String(m.sw)}/${String(m.cw)}`;
};

// ---------------------------------------------------------------- the flows

interface Run {
  stamp: string;
  facilityName: string;
  facilityCode: string;
  typeName: string;
  itemLabel: string;
  deviceName: string;
  deviceQr: string;
  sessionId: string;
  reportNumber: string;
}

const p2209Facility = async (admin: Session, run: Run): Promise<void> => {
  const page = await newTab(admin, "light");
  try {
    await must("P22-09 /dashboard/client-facilities: add a facility through the form", async () => {
      await go(page, "/dashboard/client-facilities");
      await click(page, /^Add a facility$/);
      await dialogOpen(page);
      await fill(page, "#facility-name", run.facilityName);
      await fill(page, "#facility-code", run.facilityCode);
      await choose(page, "#facility-kind", /hospital/i);
      const detail = await axe(page, "light facility form", dialog);
      await click(page, /^Add facility$/, dialog);
      await dialogsClosed(page);
      await fill(page, "#facilities-q", run.facilityCode);
      await waitText(page, new RegExp(esc(run.facilityName)));
      return `${run.facilityName} listed; ${detail}`;
    });
  } finally {
    await page.close();
  }
};

const p2201Catalogue = async (operator: Session, run: Run): Promise<void> => {
  const page = await newTab(operator, "light");
  try {
    await must("P22-01 /dashboard/ipm-templates: the operator adds a device type", async () => {
      await go(page, "/dashboard/ipm-templates");
      await click(page, /^Device types$/);
      await page.waitForSelector("#types-search", { visible: true, timeout: STEP_TIMEOUT });
      const nameField = await page.$$eval("main label", (ls) => ls.find((l) => /New device type name/.test(l.textContent ?? ""))?.getAttribute("for") ?? "");
      if (!nameField) throw new Error("no 'New device type name' field");
      await fill(page, `#${CSS_ESCAPE(nameField)}`, run.typeName);
      await click(page, /^Add device type$/);
      await fill(page, "#types-search", run.typeName);
      await waitText(page, new RegExp(esc(run.typeName)), "main table");
      return run.typeName;
    });
    await must("P22-01: create the type's checklist, open a draft, add a library item, save", async () => {
      await click(page, /^Checklists$/);
      await fill(page, "#new-template-type-search", run.typeName);
      await choose(page, "#new-template-type", new RegExp(`^${esc(run.typeName)}$`));
      await click(page, /^Create checklist$/);
      await waitText(page, new RegExp(`Draft|${esc(run.typeName)}`));
      await click(page, /^Open an empty draft$/);
      await page.waitForSelector("#add-search", { visible: true, timeout: STEP_TIMEOUT });
      await fill(page, "#add-search", run.itemLabel);
      await click(page, new RegExp(`^Add ${esc(run.itemLabel)}`));
      await click(page, /^Save items$/);
      await waitText(page, /Draft items saved/, "body");
      await page.waitForFunction(() => ![...document.querySelectorAll("main button")].some((b) => b.textContent?.trim() === "Save items" && !(b as HTMLButtonElement).disabled), { timeout: STEP_TIMEOUT });
      return axe(page, "light checklist editor");
    });
    await must("P22-01: write the change note and publish (version 1)", async () => {
      const noteId = await page.$$eval("main label", (ls) => ls.find((l) => /^Change note/.test(l.textContent?.trim() ?? ""))?.getAttribute("for") ?? "");
      if (!noteId) throw new Error("no 'Change note' field");
      await fill(page, `#${CSS_ESCAPE(noteId)}`, `P22 browser suite ${run.stamp}`);
      await click(page, /^Publish$/);
      await dialogOpen(page);
      const detail = await axe(page, "light publish confirmation", dialog);
      await click(page, /^Publish$/, dialog);
      await waitText(page, /Version 1 published/, "body");
      await waitText(page, /Version 1/, "main table");
      return detail;
    });
    await check("P22-01: the published catalogue offers the type and its item", async () => {
      await go(page, "/dashboard/ipm-templates");
      await click(page, /^Published catalogue$/);
      const picker = await page.waitForSelector("main select", { visible: true, timeout: STEP_TIMEOUT });
      const id = await picker?.evaluate((s) => s.id);
      if (!id) throw new Error("no type picker on the published catalogue");
      await choose(page, `#${id}`, new RegExp(`^${esc(run.typeName)}`));
      await waitText(page, new RegExp(esc(run.itemLabel)));
      return axe(page, "light published catalogue");
    });
  } finally {
    await page.close();
  }
};

const p2202Device = async (admin: Session, run: Run): Promise<void> => {
  const page = await newTab(admin, "light");
  try {
    await must("P22-02 /dashboard/devices: register a device of the type, in the facility, with a room", async () => {
      await go(page, "/dashboard/devices");
      await click(page, /^Add device$/);
      await dialogOpen(page);
      await fill(page, "#device-name", run.deviceName);
      await fill(page, "#device-qr", run.deviceQr);
      await fill(page, "#device-type-search", run.typeName);
      await choose(page, "#device-type", new RegExp(`^${esc(run.typeName)}$`));
      await fill(page, "#device-manufacturer", "Synthetic Medical");
      await fill(page, "#device-model", "SM-22");
      await fill(page, "#device-serial", `SN-${run.deviceQr}`);
      // An unbound administrator names the facility (the tenant serves several once this run adds one).
      await choose(page, "#device-facility", new RegExp(esc(run.facilityName)));
      await page.click('input[name="device-location-mode"][value="room"]');
      await fill(page, "#device-room", `Ruang P22 ${run.stamp}`);
      await fill(page, "#device-floor", "2");
      await choose(page, "#device-condition", /^Good$/);
      const detail = await axe(page, "light device form", dialog);
      await click(page, /^Add device$/, dialog);
      await waitText(page, new RegExp(`Add the photos of ${esc(run.deviceName)}`), dialog);
      return detail;
    });
    await must("P22-02: add both required photos (JPEG) → Finish turns on", async () => {
      const front = await makeJpeg(page, `p22-front-${run.stamp}.jpg`, 20);
      const plate = await makeJpeg(page, `p22-plate-${run.stamp}.jpg`, 200);
      for (const [slot, file] of [
        ["device_front", front],
        ["device_serial_plate", plate],
      ] as const) {
        const input = (await page.$(`#photo-${slot}`)) as ElementHandle<HTMLInputElement> | null;
        if (!input) throw new Error(`no file input for ${slot}`);
        await input.uploadFile(file);
        await page.waitForFunction((s: string) => !!document.querySelector(`section[aria-labelledby="photo-${s}-heading"] img`), { timeout: 60000 }, slot).catch(async () => {
          const said = await page.$eval(`section[aria-labelledby="photo-${slot}-heading"]`, (el) => (el as HTMLElement).innerText).catch(() => "");
          throw new Error(`the ${slot} photo never showed (${said.replace(/\s+/g, " ")})`);
        });
      }
      await waitText(page, /Both required photos are present/, dialog);
      const detail = await axe(page, "light photos dialog", dialog);
      await click(page, /^Finish$/, dialog);
      await dialogsClosed(page);
      return detail;
    });
    await check("P22-02: the register lists the device with its front-photo thumbnail", async () => {
      await go(page, "/dashboard/devices");
      const find = await page.$$eval("main label", (ls) => ls.find((l) => /^QR sticker/.test(l.textContent?.trim() ?? ""))?.getAttribute("for") ?? "");
      if (!find) throw new Error("no 'QR sticker' filter on the device list");
      await fill(page, `#${CSS_ESCAPE(find)}`, run.deviceQr);
      await waitText(page, new RegExp(esc(run.deviceQr)), "main table");
      const loaded = await page
        .waitForFunction(
          (qr: string) => {
            const row = [...document.querySelectorAll("main table tbody tr")].find((r) => (r.textContent ?? "").includes(qr));
            const img = row?.querySelector("img");
            return !!img && img.complete && img.naturalWidth > 0 ? img.getAttribute("src") : null;
          },
          { timeout: STEP_TIMEOUT },
          run.deviceQr,
        )
        .then((h) => h.jsonValue());
      return `thumbnail ${String(loaded).slice(0, 60)}…`;
    });
  } finally {
    await page.close();
  }
};

const p2203Capture = async (admin: Session, run: Run): Promise<void> => {
  const page = await newTab(admin, "light");
  try {
    await must("P22-03 /dashboard/ipm/new: the QR typed → the device's facts → Start", async () => {
      await go(page, "/dashboard/ipm/new");
      await fill(page, "#ipm-start-qr", run.deviceQr);
      await page.keyboard.press("Enter");
      await waitText(page, new RegExp(`SN-${esc(run.deviceQr)}`));
      const detail = await axe(page, "light start, device found");
      await click(page, /^Start the IPM$/);
      await page.waitForFunction(() => location.pathname.startsWith("/dashboard/ipm/capture/"), { timeout: STEP_TIMEOUT });
      run.sessionId = new URL(page.url()).pathname.split("/").pop() ?? "";
      await waitText(page, /IPM capture/, "main h1");
      // A full load from here on: the start page stays mounted (hidden) after the client navigation,
      // and the capture's selectors must see the capture alone.
      await go(page, `/dashboard/ipm/capture/${run.sessionId}`);
      return `session ${run.sessionId}; ${detail}`;
    });
    await must("P22-03 /capture: answer every item, the outcome and the recommendation", async () => {
      await page.waitForSelector("main nav[aria-label] button", { visible: true, timeout: STEP_TIMEOUT });
      const answered = await answerAll(page);
      const buttons = await page.$$("main nav[aria-label] button");
      await buttons[buttons.length - 2]?.click();
      await page.waitForSelector("#capture-inspectionOutcome", { visible: true, timeout: STEP_TIMEOUT });
      await page.select("#capture-inspectionOutcome", "pass");
      await page.select("#capture-maintenanceOutcome", "pass");
      const rec = await page.$$eval("#capture-recommendation option", (os) => os.map((o) => (o as HTMLOptionElement).value).find((v) => v !== "") ?? "");
      await page.select("#capture-recommendation", rec);
      await fill(page, "#capture-notes", `P22 browser suite ${run.stamp}`);
      await waitText(page, /Saved at/i, 'main [role="status"]', 20000);
      return `${String(answered)} answers; recommendation ${rec}; autosaved`;
    });
    await check("P22-03 /capture: the draft's stepper is axe-clean, light and dark (a section step and the header step)", async () => {
      const found: string[] = [await axe(page, "light capture header step")];
      const first = await page.$$("main nav[aria-label] button");
      await first[0]?.click();
      await waitText(page, /Environment/, "main h2");
      found.push(await axe(page, "light capture section step"));
      const dark = await newTab(admin, "dark");
      try {
        await go(dark, `/dashboard/ipm/capture/${run.sessionId}`);
        await dark.waitForSelector("main nav[aria-label] button", { visible: true, timeout: STEP_TIMEOUT });
        found.push(await axe(dark, "dark capture section step"));
        const steps = await dark.$$("main nav[aria-label] button");
        await steps[steps.length - 2]?.click();
        await dark.waitForSelector("#capture-inspectionOutcome", { visible: true, timeout: STEP_TIMEOUT });
        found.push(await axe(dark, "dark capture header step"));
      } finally {
        await dark.close();
        currentPage = page;
      }
      return found.join("; ");
    });
    await must("P22-03 /capture: the review is complete and Submit records the visit", async () => {
      const buttons = await page.$$("main nav[aria-label] button");
      await buttons[buttons.length - 1]?.click();
      await waitText(page, /Check and submit/, "main h2");
      const detail = await axe(page, "light capture review");
      await click(page, /^Submit$/);
      await waitText(page, /IPM visit .+ submitted/, "main h1", 60000);
      return detail;
    });
    await check("P22-03: the submitted capture page in dark is axe-clean", async () => {
      const dark = await newTab(admin, "dark");
      try {
        await go(dark, `/dashboard/ipm/capture/${run.sessionId}`);
        return await axe(dark, "dark capture (submitted)");
      } finally {
        await dark.close();
        currentPage = page;
      }
    });
  } finally {
    await page.close();
  }
};

const p2204History = async (admin: Session, run: Run): Promise<void> => {
  const page = await newTab(admin, "light");
  try {
    await must("P22-04 /dashboard/ipm: the history finds the visit by QR and opens it", async () => {
      await go(page, "/dashboard/ipm");
      await fill(page, "#ipm-filter-q", run.deviceQr);
      await waitText(page, new RegExp(esc(run.deviceQr)), "main table");
      await click(page, new RegExp(`^Open the visit to ${esc(run.deviceName)}`));
      await dialogOpen(page);
      await waitText(page, new RegExp(esc(run.deviceName)), dialog);
      run.reportNumber = await page.evaluate((sel: string) => {
        const d = [...document.querySelectorAll(sel)].pop();
        const dt = [...(d?.querySelectorAll("dt") ?? [])].find((x) => /Report number/.test(x.textContent ?? ""));
        return dt?.nextElementSibling?.textContent?.trim() ?? "";
      }, dialog);
      const detail = await axe(page, "light visit dialog", dialog);
      return `report ${run.reportNumber || "(none shown)"}; ${detail}`;
    });
    await must("P22-04: the visit links its report; the report renders with its sections", async () => {
      await click(page, /^Open the IPM report$/, dialog);
      await page.waitForFunction(() => /\/dashboard\/ipm\/sessions\/[^/]+\/report/.test(location.pathname), { timeout: STEP_TIMEOUT });
      await settle(page);
      await waitText(page, /IPM report/, "main h1");
      await page.waitForSelector("main article section[aria-labelledby]", { visible: true, timeout: STEP_TIMEOUT });
      if (run.reportNumber) await waitText(page, new RegExp(esc(run.reportNumber)), "main h1");
      return axe(page, "light report");
    });
    await check("P22-04: the report's PDF download produces a PDF file", async () => {
      const before = new Set(fs.readdirSync(admin.downloads));
      await click(page, /^Download (IPM report .+ as PDF|the preview as PDF)$/);
      const file = await downloaded(admin.downloads, ".pdf", before);
      const head = fs.readFileSync(file).subarray(0, 5).toString("latin1");
      if (head !== "%PDF-") throw new Error(`${path.basename(file)} starts with ${JSON.stringify(head)}, not %PDF-`);
      return `${path.basename(file)} (${String(fs.statSync(file).size)} bytes)`;
    });
  } finally {
    await page.close();
  }
};

const p2205Dates = async (admin: Session, run: Run): Promise<void> => {
  const page = await newTab(admin, "light");
  try {
    await must("P22-05 /dashboard/calibration-dates: quick entry by typed QR → saved", async () => {
      await go(page, "/dashboard/calibration-dates");
      await fill(page, "#entry-qr", run.deviceQr);
      await page.keyboard.press("Enter");
      await page.waitForSelector("#entry-date", { visible: true, timeout: STEP_TIMEOUT });
      const typed = await page.$('input[name="entry-lab-mode"][value="typed"]');
      if (!typed) throw new Error("no 'type the laboratory' choice");
      await typed.click();
      await fill(page, "#entry-lab-name", `Lab Kalibrasi P22 ${run.stamp}`);
      await fill(page, "#entry-certificate", `CERT-P22-${run.stamp}`);
      const detail = await axe(page, "light quick entry form");
      await click(page, /^Save calibration date$/);
      await waitText(page, new RegExp(`Calibration date recorded for ${esc(run.deviceName)}`), "main");
      return detail;
    });
    await check("P22-05: the calibration list shows the record", async () => {
      await click(page, /^Calibration list$/);
      await page.waitForSelector("main table", { visible: true, timeout: STEP_TIMEOUT });
      const qrFilter = await page.$$eval("main label", (ls) => ls.find((l) => /QR/.test(l.textContent ?? ""))?.getAttribute("for") ?? "");
      if (!qrFilter) throw new Error("no QR filter on the calibration list");
      await fill(page, `#${CSS_ESCAPE(qrFilter)}`, run.deviceQr);
      await waitText(page, new RegExp(esc(run.deviceQr)), "main table");
      return axe(page, "light calibration list");
    });
  } finally {
    await page.close();
  }
};

const p2206Exports = async (admin: Session, run: Run): Promise<void> => {
  const page = await newTab(admin, "light");
  try {
    await go(page, "/dashboard/exports");
    await check("P22-06 /dashboard/exports: the inventory XLSX, size first, built in the browser", async () => {
      const xlsx = await page.$('input[name="inventory-format"][value="xlsx"]');
      if (!xlsx) throw new Error("no XLSX choice for the inventory");
      await xlsx.click();
      await choose(page, "#inventory-facility", new RegExp(esc(run.facilityName)));
      const section = "main div:has(> #inventory-status)";
      await click(page, /^Check the size$/, section);
      await waitText(page, /\b1\b.*row|row.*\b1\b/i, "#inventory-status");
      const before = new Set(fs.readdirSync(admin.downloads));
      await click(page, /^Build and download$/, section);
      const file = await downloaded(admin.downloads, ".xlsx", before);
      await waitText(page, /Done: the file was handed to your browser/, "#inventory-status");
      const text = xlsxText(file);
      if (!text.includes(run.deviceQr)) throw new Error(`${path.basename(file)} does not hold ${run.deviceQr}`);
      return `${path.basename(file)} holds ${run.deviceQr}`;
    });
    await check("P22-06: the recap of every device's latest calibration (XLSX)", async () => {
      const latest = await page.$$eval("main label", (ls) => {
        const l = ls.find((x) => /latest calibration of every device/.test(x.textContent ?? ""));
        return l?.getAttribute("for") ?? (l?.querySelector("input") ? "inside" : "");
      });
      if (!latest) throw new Error("no 'latest calibration of every device' choice");
      if (latest === "inside") {
        await page.evaluate(() => {
          const l = [...document.querySelectorAll("main label")].find((x) => /latest calibration of every device/.test(x.textContent ?? ""));
          const box = l?.querySelector<HTMLInputElement>("input");
          if (box && !box.checked) box.click();
        });
      } else {
        await page.$eval(`#${CSS_ESCAPE(latest)}`, (el) => {
          if (!(el as HTMLInputElement).checked) (el as HTMLInputElement).click();
        });
      }
      await choose(page, "#recap-facility", new RegExp(esc(run.facilityName)));
      const section = "main div:has(> #recap-status)";
      await click(page, /^Check the size$/, section);
      await waitText(page, /row/i, "#recap-status");
      const before = new Set(fs.readdirSync(admin.downloads));
      await click(page, /^Build and download$/, section);
      const file = await downloaded(admin.downloads, ".xlsx", before);
      await waitText(page, /Done: the file was handed to your browser/, "#recap-status");
      const text = xlsxText(file);
      if (!text.includes(run.deviceQr)) throw new Error(`${path.basename(file)} does not hold ${run.deviceQr}`);
      if (!path.basename(file).startsWith("daftar_kalibrasi_terakhir_")) throw new Error(`the file is named ${path.basename(file)}`);
      return `${path.basename(file)} holds ${run.deviceQr}`;
    });
    await check("P22-06: the exports page is axe-clean after the builds", () => axe(page, "light exports"));
  } finally {
    await page.close();
  }
};

const p2207Dashboard = async (admin: Session, run: Run): Promise<void> => {
  const page = await newTab(admin, "light");
  try {
    await check("P22-07 /dashboard: the condition panel, the IPM figures and the technician activity", async () => {
      await go(page, "/dashboard");
      await page.waitForSelector("#dashboard-condition-title", { visible: true, timeout: STEP_TIMEOUT });
      await page.waitForSelector('section[aria-labelledby="dashboard-condition-title"] svg[role="img"][aria-label]', { visible: true, timeout: STEP_TIMEOUT });
      await page.waitForSelector("#dashboard-ipm-title", { visible: true, timeout: STEP_TIMEOUT });
      await page.waitForSelector("#dashboard-activity-title", { visible: true, timeout: STEP_TIMEOUT });
      const search = await page.$('section[aria-labelledby="dashboard-activity-title"] [role="search"] input');
      if (!search) throw new Error("no activity search");
      await search.type(run.deviceQr);
      await page.keyboard.press("Enter");
      await waitText(page, new RegExp(esc(run.deviceQr)), 'section[aria-labelledby="dashboard-activity-title"]');
      return axe(page, "light dashboard");
    });
    await check("P22-07: the condition drill-down opens the device list filtered to Good, with the device", async () => {
      await click(page, /^Show good devices$/i, 'section[aria-labelledby="dashboard-condition-title"]');
      await page.waitForFunction(() => location.pathname === "/dashboard/devices" && new URLSearchParams(location.search).get("condition") === "good", { timeout: STEP_TIMEOUT });
      await settle(page);
      const find = await page.$$eval("main label", (ls) => ls.find((l) => /^QR sticker/.test(l.textContent?.trim() ?? ""))?.getAttribute("for") ?? "");
      if (!find) throw new Error("no 'QR sticker' filter on the device list");
      await fill(page, `#${CSS_ESCAPE(find)}`, run.deviceQr);
      await waitText(page, new RegExp(esc(run.deviceQr)), "main table");
      return "filtered list holds the device";
    });
  } finally {
    await page.close();
  }
};

/** PATCH through the harness's base and headers (the harness has no PATCH helper). */
const httpPatch = async (route: string, body: unknown, headers: Record<string, string>): Promise<Reply> => {
  const res = await fetch(`${api.API_BASE}${route}`, { method: "PATCH", headers: { ...api.defaultHeaders, ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  return { status: res.status, body: (await res.json().catch(() => null)) as unknown };
};

/** A signed-out page (its own context: no session cookie), in English and `theme`. */
const signedOutTab = async (browser: Browser, theme: Theme, width = 1280, height = 900, scale = 1): Promise<{ page: Page; close: () => Promise<void> }> => {
  const context = await browser.createBrowserContext();
  const page = await newTab({ context, downloads: ARTIFACTS }, theme, width, height, scale);
  return { page, close: () => context.close() };
};

/** The visible text of the public device page once its content (or its refusal) has rendered. */
const publicText = async (page: Page, route: string): Promise<string> => {
  await page.goto(`${FRONTEND_URL}${route}`, { waitUntil: "domcontentloaded", timeout: STEP_TIMEOUT });
  await settle(page);
  await page.waitForFunction(() => !/Reading the device/.test(document.querySelector("main")?.textContent ?? ""), { timeout: STEP_TIMEOUT });
  return page.evaluate(() => (document.querySelector("main") as HTMLElement | null)?.innerText.replace(/\s+/g, " ") ?? "");
};

/**
 * P22-08 (P21-08, ADR-138): the public device page. The row action issues a link; the tenant's
 * setting turns the page on (`PATCH /tenants/settings`, the administrator's API session); the page,
 * signed out, shows the minimal fields and never the serial, the QR number, the room, a photo, a
 * document or a person's name; after the revocation it says no device answers. Every outcome is
 * HTTP 200 (ADR-138 Am. 3), so the content is asserted, never the status.
 */
const p2208PublicPage = async (browser: Browser, admin: Session, adminAccount: Account, run: Run): Promise<void> => {
  const page = await newTab(admin, "light");
  let route = "";
  const login = await api.httpPost("/auth/login", { user: adminAccount.username, password: adminAccount.password });
  const auth = api.authHeader(api.extractToken(login.body));
  // The settings routes take the tenant in the body (their gate checks it is the caller's own).
  const tenantId = str(obj(ok(await api.httpPost("/auth/verify", {}, auth), "verify"))["tenantId"]);
  const read = ok(await api.httpPost("/tenants/settings", { tenantId }, auth), "settings read");
  const before = str(obj(obj(read)["settings"])["public_device_page"]);
  try {
    await must("P22-08 /dashboard/devices: the row action \"Public link of …\" → Issue a link", async () => {
      await go(page, "/dashboard/devices");
      const find = await page.$$eval("main label", (ls) => ls.find((l) => /^QR sticker/.test(l.textContent?.trim() ?? ""))?.getAttribute("for") ?? "");
      if (!find) throw new Error("no 'QR sticker' filter on the device list");
      await fill(page, `#${CSS_ESCAPE(find)}`, run.deviceQr);
      await waitText(page, new RegExp(esc(run.deviceQr)), "main table");
      await click(page, new RegExp(`^Public link of ${esc(run.deviceName)}$`));
      await dialogOpen(page);
      await waitText(page, /no public link yet/, dialog);
      await click(page, /^Issue a link$/, dialog);
      const url = await page
        .waitForFunction((sel: string) => {
          const d = [...document.querySelectorAll(sel)].pop();
          const p = [...(d?.querySelectorAll("p") ?? [])].find((x) => /\/d\/[^/\s]+$/.test(x.textContent?.trim() ?? ""));
          return p?.textContent?.trim() ?? null;
        }, { timeout: STEP_TIMEOUT }, dialog)
        .then((h) => h.jsonValue());
      route = new URL(String(url)).pathname;
      await page.waitForSelector(`${dialog.split(",")[0] ?? dialog} img[alt]`, { visible: true, timeout: STEP_TIMEOUT });
      // The panel re-reads its state after issuing; measure once its actions are live again.
      await control(page, /^Revoke the link$/, dialog);
      const detail = await axe(page, "light public-link dialog (issued, sticker QR)", dialog);
      await page.keyboard.press("Escape");
      return `${route.replace(/(\/d\/.{6}).*/, "$1…")}; ${detail}`;
    });
    await must("P22-08: the tenant turns the public device page on (PATCH /tenants/settings minimal)", async () => {
      ok(await httpPatch("/tenants/settings", { tenantId, public_device_page: "minimal" }, auth), "settings");
      return `was ${before || "unset (off)"}`;
    });
    await check("P22-08 /d/<token> signed out: the minimal fields, and no serial, QR, room, photo, document or name", async () => {
      const out = await signedOutTab(browser, "light");
      try {
        const text = await publicText(out.page, route);
        // The page's one <h1> is the device's name (P19-07 § 10); people's names never appear.
        await waitText(out.page, new RegExp(`^${esc(run.deviceName)}$`), "main h1");
        const want = [run.typeName, "Synthetic Medical", "SM-22", run.facilityName, "Calibration status", "Next calibration", "Last IPM"];
        const missing = want.filter((w) => !text.includes(w));
        if (missing.length > 0) throw new Error(`missing ${missing.join(", ")}; the page says: ${text.slice(0, 400)}`);
        const leaks = [
          [`serial SN-${run.deviceQr}`, `SN-${run.deviceQr}`],
          [`QR ${run.deviceQr}`, run.deviceQr],
          ["room", `Ruang P22 ${run.stamp}`],
          ["the administrator's name", "P22 Administrator"],
          ["a username", adminAccount.username],
        ].filter(([, v]) => v !== undefined && text.includes(v));
        if (leaks.length > 0) throw new Error(`the page shows ${leaks.map(([k]) => k).join(", ")}`);
        const media = await out.page.evaluate(() => ({
          imgs: [...document.querySelectorAll("main img")].map((i) => i.getAttribute("src") ?? ""),
          docs: [...document.querySelectorAll("main a[href]")].map((a) => a.getAttribute("href") ?? "").filter((h) => /attachment|\.pdf|report|document/i.test(h)),
        }));
        const photos = media.imgs.filter((s) => /attachment|signed|blob:|data:image\/jpeg/i.test(s));
        if (photos.length > 0) throw new Error(`a photo is shown: ${photos.join(", ")}`);
        if (media.docs.length > 0) throw new Error(`a document is linked: ${media.docs.join(", ")}`);
        const parts = [await axe(out.page, "light public device page")];
        const dark = await signedOutTab(browser, "dark");
        try {
          await publicText(dark.page, route);
          parts.push(await axe(dark.page, "dark public device page"));
        } finally {
          await dark.close();
        }
        return `${String(want.length)} fields shown, 0 leaks; ${parts.join("; ")}`;
      } finally {
        await out.close();
        currentPage = page;
      }
    });
    await check("P22-08 /d/<token>: layout at 360, 768, 1280 and 200 % zoom (one <main>, one <h1>, no sideways scroll)", async () => {
      const found: string[] = [];
      for (const [mode, w, h, s] of [["360", 360, 780, 1], ["768", 768, 1024, 1], ["1280", 1280, 900, 1], ["zoom200", 640, 450, 2]] as const) {
        const out = await signedOutTab(browser, "light", w, h, s);
        try {
          await publicText(out.page, route);
          found.push(`${mode} ${await layout(out.page)}`);
        } finally {
          await out.close();
        }
      }
      currentPage = page;
      return found.join("; ");
    });
    await must("P22-08: the row action revokes the link", async () => {
      await go(page, "/dashboard/devices");
      const find = await page.$$eval("main label", (ls) => ls.find((l) => /^QR sticker/.test(l.textContent?.trim() ?? ""))?.getAttribute("for") ?? "");
      await fill(page, `#${CSS_ESCAPE(find)}`, run.deviceQr);
      await waitText(page, new RegExp(esc(run.deviceQr)), "main table");
      await click(page, new RegExp(`^Public link of ${esc(run.deviceName)}$`));
      await dialogOpen(page);
      await click(page, /^Revoke the link$/, dialog);
      // The confirmation is a second dialog on top: mark it and confirm inside it.
      await page.waitForFunction(
        (sel: string) => {
          const top = [...document.querySelectorAll(sel)].pop();
          if (!top || !/Revoke the public link\?/.test(top.textContent ?? "")) return false;
          top.setAttribute("data-p22-top", "");
          return true;
        },
        { timeout: STEP_TIMEOUT },
        dialog,
      );
      await axe(page, "light revoke confirmation", "[data-p22-top]");
      await click(page, /^Revoke the link$/, "[data-p22-top]");
      await waitText(page, /no public link yet/, dialog);
      return "revoked";
    });
    await check("P22-08 /d/<token> after the revocation: \"No device answers to this link.\" (axe light and dark, layout)", async () => {
      const out = await signedOutTab(browser, "light");
      try {
        const text = await publicText(out.page, route);
        if (!text.includes("No device answers to this link.")) throw new Error(`the page says: ${text.slice(0, 300)}`);
        if (text.includes(run.typeName) || text.includes(run.facilityName)) throw new Error("the revoked link still shows the device");
        const parts = [await axe(out.page, "light revoked link"), await layout(out.page)];
        const dark = await signedOutTab(browser, "dark", 360, 780);
        try {
          await publicText(dark.page, route);
          parts.push(await axe(dark.page, "dark revoked link"), `360 ${await layout(dark.page)}`);
        } finally {
          await dark.close();
        }
        return parts.join("; ");
      } finally {
        await out.close();
        currentPage = page;
      }
    });
  } finally {
    await page.close();
    // Leave the tenant's setting as this run found it.
    await httpPatch("/tenants/settings", { tenantId, public_device_page: before }, auth).catch(() => undefined);
  }
};

/** Every P22 route, light AND dark, axe; the capture and the report with this run's data. */
const routes = (run: Run): [string, string][] => [
  ["catalogue", "/dashboard/ipm-templates"],
  ["devices", "/dashboard/devices"],
  ["ipm-start", "/dashboard/ipm/new"],
  ["ipm-capture", `/dashboard/ipm/capture/${run.sessionId}`],
  ["ipm-history", "/dashboard/ipm"],
  ["ipm-report", `/dashboard/ipm/sessions/${run.sessionId}/report`],
  ["calibration-dates", "/dashboard/calibration-dates"],
  ["exports", "/dashboard/exports"],
  ["dashboard", "/dashboard"],
  ["client-facilities", "/dashboard/client-facilities"],
];

const axeSweep = async (admin: Session, operator: Session, run: Run): Promise<void> => {
  for (const theme of THEMES) {
    const page = await newTab(admin, theme);
    try {
      for (const [name, route] of routes(run)) {
        await check(`axe [${theme}] ${name} ${route}`, async () => {
          await go(page, route);
          const dark = await page.evaluate(() => document.documentElement.classList.contains("dark"));
          if (dark !== (theme === "dark")) throw new Error(`not in the ${theme} theme`);
          return axe(page, `${theme} ${name}`);
        });
      }
      await check(`axe [${theme}] the device form and the facility form dialogs`, async () => {
        await go(page, "/dashboard/devices");
        await click(page, /^Add device$/);
        await dialogOpen(page);
        const a = await axe(page, `${theme} device form`, dialog);
        await page.keyboard.press("Escape");
        await dialogsClosed(page);
        await go(page, "/dashboard/client-facilities");
        await click(page, /^Add a facility$/);
        await dialogOpen(page);
        const b = await axe(page, `${theme} facility form`, dialog);
        await page.keyboard.press("Escape");
        return `${a}; ${b}`;
      });
    } finally {
      await page.close();
    }
    const op = await newTab(operator, theme);
    try {
      for (const tab of ["Checklists", "Item library", "Device types", "Proposal queue", "Published catalogue"]) {
        await check(`axe [${theme}] operator catalogue tab "${tab}"`, async () => {
          await go(op, "/dashboard/ipm-templates");
          await click(op, new RegExp(`^${esc(tab)}$`));
          await op.waitForNetworkIdle({ idleTime: 400, timeout: 8000 }).catch(() => undefined);
          return axe(op, `${theme} catalogue ${tab}`);
        });
      }
    } finally {
      await op.close();
    }
  }
};

/** Every P22 route at 360, 768, 1280 and at 200 % zoom (a 1280 window at DSF 2 lays out at 640). */
const layoutSweep = async (admin: Session, run: Run): Promise<void> => {
  const modes: [string, number, number, number][] = [
    ["360", 360, 780, 1],
    ["768", 768, 1024, 1],
    ["1280", 1280, 900, 1],
    ["zoom200", 640, 450, 2],
  ];
  for (const [mode, width, height, scale] of modes) {
    const page = await newTab(admin, "light", width, height, scale);
    try {
      for (const [name, route] of routes(run)) {
        await check(`layout [${mode}] ${name}`, async () => {
          await go(page, route);
          return layout(page);
        });
      }
    } finally {
      await page.close();
    }
  }
};

/** CSS.escape for an id read from the page (React's useId ids hold colons). */
const CSS_ESCAPE = (id: string): string => id.replace(/([^A-Za-z0-9_-])/g, "\\$1");

// ---------------------------------------------------------------- main

const main = async (): Promise<void> => {
  const started = Date.now();
  console.log(`P22 browser suite — ${FRONTEND_URL} (facilities, catalogue, devices, IPM capture/history/report, calibration dates, exports, dashboard; axe light+dark; layout)`);
  const auth = await operatorAuth();
  const stamp = String(Date.now()).slice(-7);
  const run: Run = {
    stamp,
    facilityName: `RS Uji P22 ${stamp}`,
    facilityCode: `P22${stamp}`,
    typeName: `Pompa suntik uji ${stamp}`,
    itemLabel: `Uji oklusi P22 ${stamp}`,
    deviceName: `Pompa suntik P22 ${stamp}`,
    deviceQr: `P22Q${stamp}`,
    sessionId: "",
    reportNumber: "",
  };
  let adminAccount: Account | null = null;
  await must("setup (API): a library item for the checklist and a tenant administrator", async () => {
    ok(
      await api.httpPost(
        "/ipm/item-definitions",
        { content: { section: "function", label: run.itemLabel, inputKind: "tri_state", allowedOutcomes: ["pass", "fail", "not_applicable"] } },
        auth,
      ),
      "item definition",
    );
    adminAccount = await tenantAdmin(auth, stamp);
    return `item "${run.itemLabel}", administrator ${adminAccount.username}`;
  });
  const operatorAccount: Account = { id: "", username: api.OPERATOR, password: api.OPERATOR_PASSWORD };

  const browser = await puppeteer.launch({
    executablePath: chromePath(),
    headless: process.env["HEADFUL"] ? false : true,
    args: ["--no-first-run", "--no-default-browser-check"],
  });
  try {
    if (!adminAccount) throw new Error("no administrator");
    const admin = await openSession(browser, adminAccount, "admin");
    const operator = await openSession(browser, operatorAccount, "operator");
    await p2209Facility(admin, run);
    await p2201Catalogue(operator, run);
    await p2202Device(admin, run);
    await p2203Capture(admin, run);
    await p2204History(admin, run);
    await p2205Dates(admin, run);
    await p2206Exports(admin, run);
    await p2207Dashboard(admin, run);
    await p2208PublicPage(browser, admin, adminAccount, run);
    await axeSweep(admin, operator, run);
    await layoutSweep(admin, run);
  } catch (err) {
    console.log(`  STOP  ${err instanceof Error ? err.message : String(err)}`);
    results.push({ name: "the run completed", ok: false });
  } finally {
    await browser.close();
    const acct = adminAccount as Account | null;
    if (acct) await api.httpDelete(`/users/delete?userId=${acct.id}`, await operatorAuth()).catch(() => undefined);
  }

  const passed = results.filter((r) => r.ok).length;
  const allOk = results.length > 0 && passed === results.length;
  console.log(`\n${String(passed)}/${String(results.length)} checks passed in ${String(Date.now() - started)} ms${allOk ? "" : " — FAILED"}`);
  process.exit(allOk ? 0 : 1);
};

main().catch((err: unknown) => {
  console.error(`P22 browser suite could not run: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
});
