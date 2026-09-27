#!/usr/bin/env node
/**
 * Browser smoke suite (A-20, ADR-077).
 *
 * The 71-test Playwright suite the documents described was never in this
 * repository. This is what replaces it: FOUR checks that only a real browser
 * can make, driven through the repository's existing `puppeteer-core` (hoisted
 * from the backend's `puppeteer`) and an installed Chrome/Chromium — no new
 * dependency.
 *
 *   1. sign-in      the password step through the Next app (which owns the
 *                   session cookie — the browser never holds the access token)
 *   2. MFA          a new platform operator is sent to enrolment, enrols from
 *                   the secret the page shows, then signs in again with a code
 *   3. list page    /dashboard/devices renders a device created for it through
 *                   the API — rows in `data`, not an empty list with no error
 *   4. CSP          every page visited sends a nonce CSP and raises no
 *                   `securitypolicyviolation`, and no page throws
 *
 * It runs against a RUNNING stack: the frontend (FRONTEND_URL) and the backend
 * API (BASE_URL), seeded (GET /api/v1/migration/seeding). The operator it signs
 * in with is created for the run and deleted afterwards; the seeded operator
 * (sys@mail.com) is used only through the API, via the E2E harness, which
 * completes its MFA itself (ADR-059).
 *
 *   FRONTEND_URL=http://localhost:3001 BASE_URL=http://localhost:3000 \
 *     node automate/smoke.browser.js
 *
 * Environment:
 *   FRONTEND_URL   the Next app's origin                (default http://localhost:3001)
 *   BASE_URL       the backend's origin, for API setup  (default http://localhost:3000)
 *   CHROME_PATH    the browser executable               (default: the usual install paths)
 *   E2E_OPERATOR / E2E_OPERATOR_PASSWORD  the seeded operator (sys@mail.com / 123123)
 *   HEADFUL=1      show the browser
 *
 * Exit status 0 only when every check passed. Not part of `make verify`.
 */
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const FRONTEND_URL = (process.env.FRONTEND_URL || "http://localhost:3001").replace(/\/$/, "");
process.env.BASE_URL = process.env.BASE_URL || "http://localhost:3000";

const puppeteer = require("puppeteer-core");
const api = require(path.join(__dirname, "../backend/src/tests/e2e/setup.js"));

const OPERATOR = process.env.E2E_OPERATOR || "sys@mail.com";
const OPERATOR_PASSWORD = process.env.E2E_OPERATOR_PASSWORD || "123123";
const STEP_TIMEOUT = 30000;

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
  if (!found) {
    throw new Error(`No Chrome/Chromium found; set CHROME_PATH (tried: ${candidates.join(", ")})`);
  }
  return found;
}

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function base32Decode(secret) {
  let bits = "";
  for (const ch of String(secret).replace(/[\s=]+/g, "").toUpperCase()) {
    const v = BASE32.indexOf(ch);
    if (v < 0) throw new Error("the TOTP secret on the page is not base32");
    bits += v.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}
/** RFC 6238, SHA-1, 30 s, 6 digits — what the backend's otplib checks. */
function totp(secret, step) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = crypto.createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const o = mac[mac.length - 1] & 0xf;
  const n = ((mac[o] & 0x7f) << 24) | (mac[o + 1] << 16) | (mac[o + 2] << 8) | mac[o + 3];
  return String(n % 1e6).padStart(6, "0");
}
const currentStep = () => Math.floor(Date.now() / 30000);
/** A code for a step after `usedStep` — a TOTP step is accepted once (A-115). */
async function freshCode(secret, usedStep) {
  while (currentStep() <= usedStep) {
    await new Promise((r) => setTimeout(r, 30000 - (Date.now() % 30000) + 100));
  }
  const step = currentStep();
  return { code: totp(secret, step), step };
}

const results = [];
let currentPage = null;
const ARTIFACTS = process.env.SMOKE_ARTIFACTS || require("os").tmpdir();
async function check(name, fn) {
  const started = Date.now();
  try {
    const detail = await fn();
    results.push({ name, ok: true, ms: Date.now() - started, detail });
    console.log(`  PASS  ${name} (${Date.now() - started} ms)${detail ? ` — ${detail}` : ""}`);
  } catch (err) {
    results.push({ name, ok: false, ms: Date.now() - started, detail: err.message });
    console.log(`  FAIL  ${name} (${Date.now() - started} ms) — ${err.message}`);
    if (currentPage) {
      const shot = path.join(ARTIFACTS, `browser-smoke-failure-${Date.now()}.png`);
      await currentPage.screenshot({ path: shot, fullPage: true }).catch(() => {});
      const text = await currentPage.evaluate(() => document.body.innerText).catch(() => "");
      console.log(`        at ${currentPage.url()}; screenshot ${shot}`);
      console.log(`        page text: ${text.replace(/\s+/g, " ").slice(0, 400)}`);
    }
    throw err;
  }
}

/** Watch a page for CSP violations, page errors and the CSP header of each document. */
function instrument(page, log) {
  page.on("pageerror", (err) => log.pageErrors.push(`${page.url()}: ${err.message}`));
  page.on("console", (msg) => {
    if (/Content[- ]Security[- ]Policy/i.test(msg.text())) {
      log.violations.push(`${page.url()}: ${msg.text()}`);
    }
  });
  page.on("response", (res) => {
    if (res.status() >= 400) {
      log.httpErrors.push(`${res.status()} ${res.request().method()} ${new URL(res.url()).pathname} (on ${page.url()})`);
    }
    if (res.request().resourceType() === "document") {
      log.documents.push({ url: res.url(), csp: res.headers()["content-security-policy"] || "" });
    }
  });
  return page.evaluateOnNewDocument(() => {
    document.addEventListener("securitypolicyviolation", (e) => {
      console.error(`Content Security Policy violation: ${e.violatedDirective} ${e.blockedURI}`);
    });
  });
}

async function clickButton(page, text) {
  const handle = await page.waitForFunction(
    (label) =>
      [...document.querySelectorAll("button")].find(
        (b) => b.textContent.trim().includes(label) && !b.disabled,
      ),
    { timeout: STEP_TIMEOUT },
    text,
  );
  await handle.asElement().click();
}

async function passwordSignIn(page, email, password) {
  await page.goto(`${FRONTEND_URL}/login`, { waitUntil: "networkidle2" });
  await page.waitForSelector("#username", { timeout: STEP_TIMEOUT });
  await page.type("#username", email);
  await page.type("#password", password);
  await Promise.all([
    page.waitForResponse((r) => /\/auth\/login$/.test(new URL(r.url()).pathname), {
      timeout: STEP_TIMEOUT,
    }),
    page.click('button[type="submit"]'),
  ]);
}

// ---------------------------------------------------------------- run

async function main() {
  const started = Date.now();
  console.log(`Browser smoke — frontend ${FRONTEND_URL}, API ${process.env.BASE_URL}`);

  // ---- API setup, as the seeded operator
  const signIn = await api.httpPost("/auth/login", { user: OPERATOR, password: OPERATOR_PASSWORD });
  const adminToken = api.extractToken(signIn.body);
  if (signIn.status !== 200 || !adminToken) {
    throw new Error(`API sign-in as ${OPERATOR} failed (${signIn.status})`);
  }
  const admin = api.authHeader(adminToken);
  const tenantId = signIn.body.data.tenantId;
  const roles = await api.httpGet("/roles?limit=50", admin);
  const superAdminRole = (roles.body.data || []).find((r) => Number(r.roleLevel) === 10);
  if (!superAdminRole) throw new Error("no level-10 role in GET /roles");

  const stamp = Date.now();
  const email = `browser-smoke-${stamp}@example.com`;
  const temporary = `Temp-${stamp}-Aa1!`;
  const password = `Smoke-${stamp}-Bb2!`;
  const deviceName = `Browser Smoke Device ${stamp}`;
  let operatorId = null;
  let deviceId = null;

  const created = await api.httpPost(
    "/users/create",
    {
      tenantId,
      username: `bsmoke${stamp}`.slice(0, 20),
      firstName: "Browser",
      lastName: "Smoke",
      email,
      password: temporary,
      roleId: superAdminRole.id,
    },
    admin,
  );
  if (created.status !== 201) {
    throw new Error(`creating the smoke operator failed (${created.status}: ${created.body?.message})`);
  }
  operatorId = created.body.data.id;

  const device = await api.httpPost(
    "/calibration-devices",
    { name: deviceName, manufacturer: "Smoke", model: "B-1", serialNumber: `BS-${stamp}`, status: "active" },
    admin,
  );
  if (device.status !== 201) throw new Error(`creating the smoke device failed (${device.status})`);
  deviceId = device.body.data.id;

  // The administrator-set password is replaced through the API: the forced
  // change-password screen is not one of the four checks.
  // A raw sign-in: the harness's httpPost would try to enrol MFA for a
  // level-10 account, which is the browser's job here.
  const firstRes = await fetch(`${api.API_BASE}/auth/login`, {
    method: "POST",
    headers: api.defaultHeaders,
    body: JSON.stringify({ user: email, password: temporary }),
  });
  const first = { status: firstRes.status, body: await firstRes.json() };
  const changed = await api.httpPost(
    "/auth/just-update-password",
    { currentPassword: temporary, newPassword: password },
    api.authHeader(api.extractToken(first.body)),
  );
  if (changed.status !== 200) throw new Error(`setting the smoke operator's password failed (${changed.status})`);

  const log = { violations: [], pageErrors: [], documents: [], httpErrors: [] };
  const browser = await puppeteer.launch({
    executablePath: chromePath(),
    headless: process.env.HEADFUL ? false : true,
    args: ["--no-first-run", "--no-default-browser-check"],
  });
  let failed = false;
  try {
    let secret = null;
    let usedStep = -1;

    // ---- 1 + 2a: password sign-in lands a new operator on MFA enrolment
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    currentPage = page;
    await instrument(page, log);

    await check("sign-in: the password step reaches the app and routes an operator without MFA to enrolment", async () => {
      await passwordSignIn(page, email, password);
      await page.waitForFunction(() => location.pathname === "/dashboard/mfa", { timeout: STEP_TIMEOUT });
      return page.url();
    });

    await check("MFA enrolment: the secret on the page verifies and recovery codes are issued", async () => {
      await clickButton(page, "Set Up Authenticator");
      const secretHandle = await page.waitForFunction(
        () => {
          const label = [...document.querySelectorAll("p")].find((p) =>
            p.textContent.includes("Or enter this secret manually"),
          );
          const span = label && label.parentElement.querySelector("button span");
          return span && span.textContent.trim().length >= 16 ? span.textContent.trim() : null;
        },
        { timeout: STEP_TIMEOUT },
      );
      secret = await secretHandle.jsonValue();
      const { code, step } = await freshCode(secret, usedStep);
      usedStep = step;
      await page.type("#mfa-enroll-code", code);
      await clickButton(page, "Verify & Enable");
      await page.waitForSelector('ul[aria-label="Recovery codes"] li', { timeout: STEP_TIMEOUT });
      const count = await page.$$eval('ul[aria-label="Recovery codes"] li', (li) => li.length);
      await page.click('input[type="checkbox"]');
      await clickButton(page, "Done");
      return `${count} recovery codes`;
    });
    await context.close();

    // ---- 2b: a fresh browser signs in with password + code
    const context2 = await browser.createBrowserContext();
    const page2 = await context2.newPage();
    currentPage = page2;
    await instrument(page2, log);

    await check("MFA sign-in: password then a 6-digit code opens the dashboard", async () => {
      await passwordSignIn(page2, email, password);
      await page2.waitForSelector("#mfa-code", { timeout: STEP_TIMEOUT });
      const { code, step } = await freshCode(secret, usedStep);
      usedStep = step;
      await page2.type("#mfa-code", code);
      await page2.click('button[type="submit"]');
      await page2.waitForFunction(() => location.pathname.startsWith("/dashboard") && location.pathname !== "/dashboard/mfa", {
        timeout: STEP_TIMEOUT,
      });
      return new URL(page2.url()).pathname;
    });

    // ---- 3: one list page renders the row created for it
    await check("list page: /dashboard/devices renders the device created through the API", async () => {
      const listResponse = page2.waitForResponse(
        (r) => new URL(r.url()).pathname.endsWith("/calibration-devices") && r.request().method() === "GET",
        { timeout: STEP_TIMEOUT },
      );
      await page2.goto(`${FRONTEND_URL}/dashboard/devices`, { waitUntil: "domcontentloaded" });
      const res = await listResponse;
      if (res.status() !== 200) throw new Error(`the list request answered ${res.status()}`);
      await page2.waitForFunction((name) => document.body.innerText.includes(name), { timeout: STEP_TIMEOUT }, deviceName);
      const rows = await page2.$$eval("table tbody tr", (tr) => tr.length);
      return `${rows} row(s), including "${deviceName}"`;
    });
    await context2.close();

    // ---- 4: CSP and page errors across everything visited
    await check("CSP: every document carried a nonce policy and nothing was blocked or threw", async () => {
      const appDocs = log.documents.filter((d) => d.url.startsWith(FRONTEND_URL));
      const missing = appDocs.filter((d) => !/script-src[^;]*'nonce-/.test(d.csp));
      const problems = [
        ...missing.map((d) => `no nonce CSP on ${d.url}`),
        ...log.violations,
        ...log.pageErrors,
      ];
      if (appDocs.length === 0) problems.push("no document from the frontend was observed");
      if (problems.length) throw new Error(problems.join("\n        "));
      return `${appDocs.length} document(s), 0 violations, 0 page errors`;
    });
  } catch {
    failed = true;
  } finally {
    await browser.close();
    if (deviceId) await api.httpDelete(`/calibration-devices/${deviceId}`, admin).catch(() => {});
    if (operatorId) await api.httpDelete(`/users/delete?userId=${operatorId}`, admin).catch(() => {});
  }

  if (log.httpErrors.length) {
    console.log(`\n  HTTP errors the pages received (informational):\n    ${log.httpErrors.join("\n    ")}`);
  }
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/4 checks passed in ${Date.now() - started} ms${failed || passed !== 4 ? " — FAILED" : ""}`);
  process.exit(failed || passed !== 4 ? 1 : 0);
}

main().catch((err) => {
  console.error(`Browser smoke could not run: ${err.message}`);
  process.exit(2);
});
