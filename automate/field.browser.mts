#!/usr/bin/env node
/**
 * P22-10c3 (P19-08 § 16.3) — the offline field app `/field` in a real browser, against a RUNNING,
 * seeded stack (deploy/compose/docker-compose.e2e.yml, built from the tree under test).
 *
 *   setup      as the operator (API): a client facility, a device type with a published checklist
 *              (one required tri-state item), two devices in the facility with QR codes, and two
 *              provider technicians (unbound) whose one-time passwords are replaced (A-123).
 *   prepare    technician A signs in; `/field` → Settings → choose the facility → sizes BEFORE the
 *              download → download; the worker is registered with scope `/field`; after a reload it
 *              controls the page and the warm-up has run; **no `/api` URL in any `cf-*` cache**.
 *   offline    CDP offline; reload `/field` → served by the worker (the shell), 0 CSP violations;
 *              type a QR → the device → start an IPM → answer → submit; register a NEW device and
 *              start its IPM (it waits for the registration); everything kept in the outbox.
 *   sync       back online; "Sync now" → on the server (read through the API): the two sessions
 *              submitted, `capturedOffline` true, the new device registered once (its `clientRef`).
 *   sign-out   a capture left pending → "Turn off offline mode" is refused with its count.
 *   AM-23      technician B signs in on the SAME profile → `/field` says another user's offline
 *              data is on this phone and offline mode cannot be enabled; A's outbox untouched.
 *   a11y       axe (WCAG 2.1 A/AA) on the field screens, light AND dark; at 360×640, 390×844 and
 *              768×1024 no horizontal scroll.
 *
 * Not here (proven elsewhere, named in the record): the administrator wipe and the scope
 * fingerprint purge run in the component suite over the real store (`FieldApp.test.tsx`,
 * `fieldStore.test.ts`); the 72-hour purge and the server-clock purge in the runtime tests; the
 * camera on a real phone in the real-device script (TASKS/RUNBOOK-FIELD-REAL-DEVICE.md).
 *
 *   FRONTEND_URL=http://localhost:27331 BASE_URL=http://127.0.0.1:27330 \
 *   E2E_OPERATOR_PASSWORD=… [E2E_BOOTSTRAP_PASSWORD=…] node automate/field.browser.mts
 *
 * Environment: CHROME_PATH, HEADFUL=1, FIELD_ARTIFACTS=<dir> (failure screenshots). Exit status 0
 * only when every check passed. Not part of `make verify`. Synthetic data only.
 */
import { createRequire } from "node:module";
import { createHash, createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import puppeteer from "puppeteer-core";
import type { BrowserContext, CDPSession, Page } from "puppeteer-core";

const require = createRequire(import.meta.url);
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));

const FRONTEND_URL = (process.env["FRONTEND_URL"] ?? "http://localhost:3001").replace(/\/$/, "");
process.env["BASE_URL"] = process.env["BASE_URL"] ?? "http://localhost:3000";
const STEP_TIMEOUT = 30000;
const ARTIFACTS = process.env["FIELD_ARTIFACTS"] ?? os.tmpdir();

interface Reply {
  status: number;
  body: unknown;
}
interface Harness {
  OPERATOR: string;
  OPERATOR_PASSWORD: string;
  httpGet: (path: string, headers?: Record<string, string>) => Promise<Reply>;
  httpPost: (path: string, body: unknown, headers?: Record<string, string>) => Promise<Reply>;
  httpPut: (path: string, body: unknown, headers?: Record<string, string>) => Promise<Reply>;
  extractToken: (body: unknown) => string | null;
  authHeader: (token: string | null) => Record<string, string>;
}
const api = require(path.join(here, "../backend/src/tests/e2e/setup.js")) as Harness;
const AXE_SOURCE = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

const obj = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const dataOf = (r: Reply): unknown => obj(r.body)["data"];

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


/**
 * Answers every item of the open capture the simplest valid way: the first outcome of each choice
 * group (and the cleanliness), "not applicable" for a reading. The standard's base items are part
 * of every published checklist; this is not what the suite measures, it only completes the form.
 */
const answerAll = async (page: Page): Promise<number> => {
  const steps = await page.$$eval('main nav[aria-label] button', (bs) => bs.map((b) => b.textContent ?? ""));
  let answered = 0;
  for (let i = 0; i < steps.length - 2; i++) {
    const buttons = await page.$$("main nav[aria-label] button");
    await buttons[i]?.click();
    await sleep(150);
    answered += await page.evaluate(async () => {
      const pause = () => new Promise((r) => setTimeout(r, 60));
      let n = 0;
      for (const box of [...document.querySelectorAll<HTMLInputElement>("main input[type=checkbox]")]) {
        if (!box.checked && /Tidak berlaku|Not applicable/.test(box.parentElement?.textContent ?? "")) {
          box.click();
          n += 1;
          await pause();
        }
      }
      for (const group of [...document.querySelectorAll("main [role=group]")]) {
        if (group.querySelector('button[aria-pressed="true"]')) continue;
        const first = group.querySelector<HTMLButtonElement>("button:not([disabled])");
        if (first) {
          first.click();
          n += 1;
          await pause();
        }
      }
      return n;
    });
    // A reading that cannot be "not applicable" gets a plausible value (25: a room's °C or % RH).
    for (const input of await page.$$('main input:not([type=checkbox]):not([type=file]):not([type=search])')) {
      const empty = await input.evaluate((el) => {
        const i = el as HTMLInputElement;
        const label = i.id ? (document.querySelector(`label[for="${i.id}"]`)?.textContent ?? "") : "";
        return i.value === "" && !i.disabled && /Pembacaan|Reading/.test(label);
      });
      if (empty) {
        await input.type("25");
        answered += 1;
      }
    }
  }
  return answered;
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
      const shot = path.join(ARTIFACTS, `field-browser-failure-${String(Date.now())}.png`);
      fs.mkdirSync(ARTIFACTS, { recursive: true });
      await currentPage.screenshot({ path: shot as `${string}.png`, fullPage: true }).catch(() => undefined);
      const text = await currentPage.evaluate(() => (document.querySelector("main") ?? document.body).textContent?.replace(/\s+/g, " ").slice(0, 1500) ?? "").catch(() => "");
      console.log(`        at ${currentPage.url()}; screenshot ${shot}; the page says: ${text}`);
    }
    return false;
  }
};

/** A step that the next ones need: a failure stops the run (its dependants could only fail). */
const must = async (name: string, fn: () => Promise<string>): Promise<void> => {
  if (!(await check(name, fn))) throw new Error(`stopped after "${name}"`);
};

// ---------------------------------------------------------------- API setup (synthetic data)

const ok = (r: Reply, what: string): unknown => {
  if (r.status < 200 || r.status >= 300) throw new Error(`${what}: ${String(r.status)} ${JSON.stringify(r.body).slice(0, 300)}`);
  return dataOf(r);
};

interface Setup {
  token: string;
  facilityId: string;
  facilityName: string;
  deviceTypeId: string;
  deviceQr: string;
  deviceName: string;
  techA: { id: string; username: string; password: string };
  techB: { id: string; username: string; password: string };
}

const operatorToken = async (): Promise<string> => {
  const login = await api.httpPost("/auth/login", { user: api.OPERATOR, password: api.OPERATOR_PASSWORD });
  const token = api.extractToken(login.body);
  if (!token) throw new Error(`the operator could not sign in (${String(login.status)})`);
  return token;
};

/** A provider technician (unbound) with a password of our choosing (the one-time one replaced). */
const technician = async (token: string, tenantId: string, stamp: string, n: string): Promise<{ id: string; username: string; password: string }> => {
  const auth = api.authHeader(token);
  const roles = arr(ok(await api.httpGet("/roles?limit=100", auth), "roles"));
  const role = roles.map(obj).find((r) => str(r["name"]) === "TECHNICIAN");
  if (!role) throw new Error("no TECHNICIAN role on this stack");
  const username = `fld${n}${stamp}`.slice(0, 20);
  const oneTime = `Tmp${stamp}Aa1`;
  const created = obj(ok(await api.httpPost("/users/create", { username, firstName: "Field", lastName: `Tech ${n.toUpperCase()}`, email: `${username}@e2e.test`, password: oneTime, roleId: str(role["id"]), tenantId }, auth), "user create"));
  const first = await api.httpPost("/auth/login", { user: username, password: oneTime });
  const firstToken = str(obj(first.body)["token"]);
  if (!firstToken) throw new Error(`the new technician's first sign-in gave no token (${String(first.status)})`);
  const password = `Fld${stamp}${n}Zz9`;
  ok(await api.httpPost("/auth/first-sign-in/password", { token: firstToken, newPassword: password }), "first-sign-in password");
  // A sign-in through the harness enrols MFA when the tenant requires it (the secret kept in its state file).
  await api.httpPost("/auth/login", { user: username, password });
  return { id: str(created["id"]), username, password };
};

const setup = async (): Promise<Setup> => {
  const token = await operatorToken();
  const auth = api.authHeader(token);
  // The operator's own tenant: the facility is created there, so the technicians belong there too
  // (a user created without one has no tenant and no session — reported, P22-10c3 record).
  const tenantId = str(obj(ok(await api.httpPost("/auth/verify", {}, auth), "verify"))["tenantId"]);
  const stamp = String(Date.now()).slice(-7);
  const facility = obj(ok(await api.httpPost("/client-facilities", { name: `RS Uji Lapangan ${stamp}`, code: `FLD${stamp}`, kind: "hospital" }, auth), "facility"));
  const type = obj(ok(await api.httpPost("/device-types", { name: `Pompa infus uji ${stamp}` }, auth), "device type"));
  const definition = obj(ok(await api.httpPost("/ipm/item-definitions", { content: { section: "function", label: `Uji alarm ${stamp}`, inputKind: "tri_state", allowedOutcomes: ["pass", "fail", "not_applicable"] } }, auth), "item definition"));
  const template = obj(ok(await api.httpPost("/ipm/templates", { deviceTypeId: str(type["id"]) }, auth), "template"));
  let draft = obj(template["openDraft"]);
  if (!str(draft["id"])) draft = obj(ok(await api.httpPost(`/ipm/templates/${str(template["id"])}/versions`, {}, auth), "draft"));
  // The draft starts with the base set of the standard; they are kept but made optional, so the
  // suite's capture answers ONE required item (the base items are the checklist's, not this test's).
  const current = obj(ok(await api.httpGet(`/ipm/template-versions/${str(draft["id"])}`, auth), "draft read"));
  const base = arr(current["items"])
    .map(obj)
    .map((i) => str(i["itemDefinitionId"]))
    .filter((id) => id !== "");
  const items = [...new Set(base)].map((itemDefinitionId) => ({ itemDefinitionId, required: false }));
  items.push({ itemDefinitionId: str(definition["id"]), required: true });
  const withItems = obj(ok(await api.httpPut(`/ipm/template-versions/${str(draft["id"])}/items`, { revision: Number(current["revision"] ?? draft["revision"] ?? 0), items }, auth), "draft items"));
  ok(await api.httpPost(`/ipm/template-versions/${str(draft["id"])}/publish`, { revision: Number(withItems["revision"] ?? 0), changeNote: "P22-10c3 browser suite" }, auth), "publish");
  const deviceQr = `FLD${stamp}1`;
  const deviceName = `Pompa uji ${stamp}`;
  for (const [name, qr] of [
    [deviceName, deviceQr],
    [`Monitor uji ${stamp}`, `FLD${stamp}2`],
  ] as const) {
    ok(await api.httpPost("/calibration-devices", { name, clientFacilityId: str(facility["id"]), deviceTypeId: str(type["id"]), qrCode: qr, serialNumber: `SN-${qr}` }, auth), `device ${name}`);
  }
  return {
    token,
    facilityId: str(facility["id"]),
    facilityName: str(facility["name"]),
    deviceTypeId: str(type["id"]),
    deviceQr,
    deviceName,
    techA: await technician(token, tenantId, stamp, "a"),
    techB: await technician(token, tenantId, stamp, "b"),
  };
};

// ---------------------------------------------------------------- browser helpers

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

/** RFC 6238 for a step this account has not used (the harness's state file is shared). */
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

/** The visible `<h1>` text of `<main>` once it renders. */
const heading = async (page: Page, pattern: RegExp): Promise<string> => {
  const handle = await page.waitForFunction(
    (src: string) => {
      const h = document.querySelector("main h1");
      return h && new RegExp(src).test(h.textContent ?? "") ? h.textContent : null;
    },
    { timeout: STEP_TIMEOUT },
    pattern.source,
  );
  return String(await handle.jsonValue());
};

/** Click the first visible button or link in `<main>` whose text or name matches. */
const click = async (page: Page, pattern: RegExp, selector = "main button, main a"): Promise<void> => {
  const deadline = Date.now() + STEP_TIMEOUT;
  for (;;) {
    for (const h of await page.$$(selector)) {
      const ready = await h.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return { label: `${el.getAttribute("aria-label") ?? ""} ${el.textContent ?? ""}`.trim(), visible: r.width > 0 && r.height > 0, disabled: (el as HTMLButtonElement).disabled === true };
      });
      if (ready.visible && !ready.disabled && pattern.test(ready.label)) {
        await h.click();
        return;
      }
    }
    if (Date.now() > deadline) throw new Error(`no enabled control matching ${String(pattern)}`);
    await sleep(250);
  }
};

const typeInto = async (page: Page, label: RegExp, value: string): Promise<void> => {
  const id = await page.waitForFunction(
    (src: string) => [...document.querySelectorAll("main label")].find((l) => new RegExp(src).test(l.textContent ?? ""))?.getAttribute("for") ?? null,
    { timeout: STEP_TIMEOUT },
    label.source,
  );
  const target = `#${String(await id.jsonValue())}`;
  await page.click(target, { count: 3 });
  await page.type(target, value);
};

const selectBy = async (page: Page, label: RegExp, value: string): Promise<void> => {
  const id = await page.waitForFunction(
    (src: string) => [...document.querySelectorAll("main label")].find((l) => new RegExp(src).test(l.textContent ?? ""))?.getAttribute("for") ?? null,
    { timeout: STEP_TIMEOUT },
    label.source,
  );
  await page.select(`#${String(await id.jsonValue())}`, value);
};

const axe = async (page: Page, label: string): Promise<string> => {
  const has = await page.evaluate(() => typeof (window as unknown as { axe?: unknown }).axe !== "undefined");
  if (!has) await page.evaluate(AXE_SOURCE);
  const violations = await page.evaluate(async () => {
    const w = window as unknown as { axe: { run: (c: Document, o: unknown) => Promise<{ violations: { id: string; nodes: { target: string[] }[] }[] }> } };
    const res = await w.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] }, resultTypes: ["violations"] });
    return res.violations.map((v) => `${v.id} × ${String(v.nodes.length)}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
  });
  if (violations.length > 0) throw new Error(`axe (${label}): ${violations.join("; ")}`);
  return `${label}: axe 0`;
};

/** Every URL the `cf-*` caches hold. */
const cachedUrls = (page: Page): Promise<string[]> =>
  page.evaluate(async () => {
    const out: string[] = [];
    for (const name of await caches.keys()) {
      if (!name.startsWith("cf-")) continue;
      const cache = await caches.open(name);
      for (const req of await cache.keys()) out.push(req.url);
    }
    return out;
  });

const go = async (page: Page, view: string): Promise<void> => {
  await page.evaluate((v: string) => {
    window.history.pushState(null, "", `/field?view=${v}`);
    window.dispatchEvent(new Event("cf:navigate"));
  }, view);
};

// ---------------------------------------------------------------- the run

const main = async (): Promise<void> => {
  console.log(`field.browser — ${FRONTEND_URL}`);
  let s: Setup | null = null;
  await must("setup: facility, device type, published checklist, two devices, two technicians (API)", async () => {
    s = await setup();
    return `facility ${s.facilityName}`;
  });
  const set = s as unknown as Setup;

  const browser = await puppeteer.launch({ executablePath: chromePath(), headless: process.env["HEADFUL"] ? false : true, args: ["--no-first-run", "--no-default-browser-check"] });
  let context: BrowserContext | null = null;
  try {
    context = await browser.createBrowserContext();
    const page = await context.newPage();
    currentPage = page;
    await page.setViewport({ width: 390, height: 844 });
    await page.evaluateOnNewDocument(() => {
      (window as unknown as { __cspViolations: string[] }).__cspViolations = [];
      document.addEventListener("securitypolicyviolation", (e) => (window as unknown as { __cspViolations: string[] }).__cspViolations.push(`${e.violatedDirective} ${e.blockedURI}`));
    });
    const cdp: CDPSession = await page.createCDPSession();

    await must("technician A signs in; /field opens on Settings (offline mode is opt-in)", async () => {
      await signIn(page, set.techA.username, set.techA.password);
      await page.goto(`${FRONTEND_URL}/field`, { waitUntil: "networkidle2", timeout: STEP_TIMEOUT });
      return await heading(page, /Pengaturan luring|Offline settings/);
    });

    await must("prepare: the facility's size is shown BEFORE the download; download; Home", async () => {
      await click(page, /Pilih fasilitas|Choose facilities/);
      await click(page, new RegExp(set.facilityName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "main label");
      await click(page, /Periksa ukuran|Check the size/);
      await page.waitForFunction(() => /2 alat|2 devices/.test(document.querySelector("main")?.textContent ?? ""), { timeout: STEP_TIMEOUT });
      await click(page, /Unduh untuk kerja luring|Download for offline work/);
      return await heading(page, /Beranda lapangan|Field home/);
    });

    await must("the worker: registered with scope /field; after a reload it controls the page", async () => {
      const scope = await page.evaluate(async () => (await navigator.serviceWorker.getRegistration("/field"))?.scope ?? null);
      if (!scope || !scope.endsWith("/field")) throw new Error(`the registration's scope is ${String(scope)}`);
      await page.reload({ waitUntil: "networkidle2" });
      await page.waitForFunction(() => navigator.serviceWorker.controller !== null, { timeout: STEP_TIMEOUT });
      await heading(page, /Beranda lapangan|Field home/);
      await sleep(3000); // the warm-up fetches every static file through the worker
      return scope;
    });

    await check("the caches hold the shell and static files, and NO /api URL (FT-84)", async () => {
      const urls = await cachedUrls(page);
      const apiUrls = urls.filter((u) => new URL(u).pathname.startsWith("/api/"));
      if (apiUrls.length > 0) throw new Error(`API responses cached: ${apiUrls.join(", ")}`);
      if (!urls.some((u) => new URL(u).pathname === "/field")) throw new Error("no /field shell in the cache");
      const statics = urls.filter((u) => new URL(u).pathname.startsWith("/_next/static/")).length;
      if (statics < 5) throw new Error(`only ${String(statics)} static files cached`);
      return `${String(urls.length)} cached, ${String(statics)} static, 0 /api`;
    });

    await must("offline: /field reloads from the worker with 0 CSP violations", async () => {
      await cdp.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
      await page.setOfflineMode(true);
      await page.reload({ waitUntil: "domcontentloaded", timeout: STEP_TIMEOUT });
      await heading(page, /Beranda lapangan|Field home/);
      const violations = await page.evaluate(() => (window as unknown as { __cspViolations: string[] }).__cspViolations);
      if (violations.length > 0) throw new Error(`CSP violations: ${violations.join("; ")}`);
      const badge = await page.evaluate(() => document.querySelector("header")?.textContent ?? "");
      if (!/Luring|Offline/.test(badge)) throw new Error(`the header does not say offline: ${badge}`);
      return "shell served offline";
    });

    await must("offline: a typed QR finds the device; an IPM is captured and submitted to the outbox", async () => {
      await go(page, "scan");
      await heading(page, /Pindai kode QR|Scan a QR code/);
      await typeInto(page, /^Kode QR$|^QR code$/, set.deviceQr);
      await click(page, /^Cari$|^Find$/);
      await click(page, new RegExp(set.deviceName), "main a");
      await heading(page, new RegExp(set.deviceName));
      await click(page, /Mulai IPM|Start IPM/);
      await heading(page, /IPM:/);
      await answerAll(page);
      await click(page, /\d+\. (Hasil dan rekomendasi|Outcome and recommendation)/);
      await selectBy(page, /^Rekomendasi$|^Recommendation$/, "fit_for_use");
      await selectBy(page, /^Hasil pemeriksaan$|^Inspection outcome$/, "pass");
      await selectBy(page, /^Hasil pemeliharaan$|^Maintenance outcome$/, "pass");
      await click(page, /\d+\. (Periksa dan kirim|Check and submit)/);
      await click(page, /^Kirim$|^Submit$/);
      await heading(page, /Antrean|Outbox/);
      return "1 IPM in the outbox";
    });

    await must("offline: a NEW device is registered and its IPM started (it waits for the registration)", async () => {
      await go(page, "register");
      await heading(page, /Daftarkan alat|Register a device/);
      await typeInto(page, /Nama alat|Device name/, `Alat baru luring ${String(Date.now()).slice(-5)}`);
      await selectBy(page, /^Fasilitas|^Facility/, set.facilityId);
      await selectBy(page, /Jenis alat|Device type/, set.deviceTypeId);
      await click(page, /Simpan di ponsel|Save on this phone/);
      await heading(page, /Alat disimpan|Device saved/);
      await click(page, /Mulai IPM untuk alat ini|Start an IPM of this device/);
      await heading(page, /Perekaman IPM|IPM capture/);
      await answerAll(page);
      await click(page, /\d+\. (Hasil dan rekomendasi|Outcome and recommendation)/);
      await selectBy(page, /^Rekomendasi$|^Recommendation$/, "fit_for_use");
      await selectBy(page, /^Hasil pemeriksaan$|^Inspection outcome$/, "pass");
      await selectBy(page, /^Hasil pemeliharaan$|^Maintenance outcome$/, "pass");
      await click(page, /\d+\. (Periksa dan kirim|Check and submit)/);
      await click(page, /^Kirim$|^Submit$/);
      await heading(page, /Antrean|Outbox/);
      const text = await page.evaluate(() => document.querySelector("main")?.textContent ?? "");
      if (!/Menunggu pendaftaran alatnya tersinkron|Waits for its device registration to sync/.test(text)) throw new Error("the new device's IPM does not say it waits for the registration");
      return "registration + dependent IPM queued";
    });

    await must("online: Sync now → on the server, two sessions submitted offline and the device once", async () => {
      await page.setOfflineMode(false);
      await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
      // CDP's emulation changes navigator.onLine but fires no `online` event; a phone's radio does.
      await page.evaluate(() => window.dispatchEvent(new Event("online")));
      await go(page, "home");
      await heading(page, /Beranda lapangan|Field home/);
      for (let i = 0; i < 6; i++) {
        await click(page, /Sinkronkan sekarang|Sync now/);
        await sleep(2500);
        const sessions = arr(dataOf(await api.httpGet(`/ipm/sessions?performedBy=${set.techA.id}&status=submitted&limit=10`, api.authHeader(set.token))));
        if (sessions.length >= 2) break;
      }
      const sessions = arr(dataOf(await api.httpGet(`/ipm/sessions?performedBy=${set.techA.id}&status=submitted&limit=10`, api.authHeader(set.token)))).map(obj);
      if (sessions.length !== 2) throw new Error(`${String(sessions.length)} submitted sessions on the server, not 2`);
      if (!sessions.every((x) => x["capturedOffline"] === true)) throw new Error("a session is not marked captured offline");
      const devices = arr(dataOf(await api.httpGet(`/calibration-devices?clientFacilityId=${set.facilityId}&limit=50`, api.authHeader(set.token))));
      if (devices.length !== 3) throw new Error(`${String(devices.length)} devices in the facility, not 3 (2 seeded + 1 registered once)`);
      return `2 sessions (captured offline), ${String(devices.length)} devices`;
    });

    await check("sign-out: with a capture pending, turning offline mode off is refused with its count", async () => {
      await go(page, "scan");
      await typeInto(page, /^Kode QR$|^QR code$/, set.deviceQr);
      await click(page, /^Cari$|^Find$/);
      await click(page, new RegExp(set.deviceName), "main a");
      await click(page, /Mulai IPM|Start IPM|Lanjutkan draf IPM|Resume the IPM draft/);
      await heading(page, /IPM:/);
      await go(page, "settings");
      await click(page, /Matikan mode luring|Turn off offline mode/);
      await page.waitForFunction(() => /belum tersinkron|not synced/.test(document.querySelector("main [role=alert]")?.textContent ?? ""), { timeout: STEP_TIMEOUT });
      return "refused";
    });

    for (const theme of ["light", "dark"] as const) {
      await check(`axe on the field screens (${theme})`, async () => {
        await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: theme }]);
        const out: string[] = [];
        for (const view of ["home", "scan", "outbox", "sign", "settings", "register"]) {
          await go(page, view);
          await sleep(600);
          out.push(await axe(page, `${view}/${theme}`));
        }
        return out.length.toString() + " screens";
      });
    }

    await check("responsive: no horizontal scroll at 360×640, 390×844, 768×1024", async () => {
      const bad: string[] = [];
      for (const [w, h] of [
        [360, 640],
        [390, 844],
        [768, 1024],
      ] as const) {
        await page.setViewport({ width: w, height: h });
        for (const view of ["home", "scan", "outbox", "settings", "register"]) {
          await go(page, view);
          await sleep(400);
          const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
          if (over > 1) bad.push(`${view}@${String(w)}: +${String(over)} px`);
        }
      }
      if (bad.length > 0) throw new Error(bad.join(", "));
      return "15 screen × width pairs";
    });

    await check("AM-23: technician B on the same profile cannot enable offline mode while A's outbox is here", async () => {
      await page.setViewport({ width: 390, height: 844 });
      await page.evaluate(async () => {
        await fetch("/api/v1/auth/logout", { method: "POST", credentials: "same-origin" });
      });
      await signIn(page, set.techB.username, set.techB.password);
      await page.goto(`${FRONTEND_URL}/field`, { waitUntil: "networkidle2", timeout: STEP_TIMEOUT });
      await heading(page, /Pengaturan luring|Offline settings/);
      await page.waitForFunction(() => /pengguna lain|another user/i.test(document.querySelector("main")?.textContent ?? ""), { timeout: STEP_TIMEOUT });
      const flags = await page.evaluate(() => localStorage.getItem("cf.field.present"));
      if (flags !== "1") throw new Error("the profile lost its field flag");
      return "blocked, A's data kept";
    });
  } finally {
    await context?.close().catch(() => undefined);
    await browser.close();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\nfield.browser: ${String(results.length - failed.length)} passed, ${String(failed.length)} failed`);
  process.exitCode = failed.length === 0 ? 0 : 1;
};

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\nfield.browser: ${String(results.length - failed)} passed, ${String(failed)} failed (stopped)`);
  process.exitCode = 1;
});
