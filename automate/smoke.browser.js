#!/usr/bin/env node
/**
 * Browser smoke suite (A-20, ADR-077).
 *
 * The 71-test Playwright suite the documents described was never in this
 * repository. This is what replaces it: four things only a real browser
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
 *   4. certificate  M-11 (ADR-095): the backend renders no PDF. The dashboard's
 *      PDF         certificates tab renders one in the browser from
 *                   GET /certificates/:id/document, and the public
 *                   verification page renders a SIGNED certificate's PDF from
 *                   its published document — each a real `%PDF` carrying the
 *                   QR image, the certificate number and the v2 integrity hash
 *   5. CSP          every page visited sends a nonce CSP and raises no
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
 *   E2E_OPERATOR / E2E_OPERATOR_PASSWORD  the operator (sys@mail.com / the password you set; see backend/src/tests/e2e/setup.js, P10-16)
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
// P10-16 (ADR-099): no default operator password; e2e/setup.js refuses to load without one.
const OPERATOR_PASSWORD = api.OPERATOR_PASSWORD;
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
  await Promise.all([
    page.waitForResponse((r) => /\/auth\/login$/.test(new URL(r.url()).pathname), {
      timeout: STEP_TIMEOUT,
    }),
    page.click('form:has(#password) button[type="submit"]'),
  ]);
}

/**
 * Click the button named `label` and return the PDF the page hands to the
 * browser as a Blob download: the anchor's click is recorded, and the blob is
 * read back inside the page. What the user would save, byte for byte.
 */
async function capturePdfDownload(page, label) {
  // The Blob is taken where the page creates its URL, and read with
  // Blob#arrayBuffer — a fetch() of the blob: URL would be refused by the
  // page's own connect-src, which is right and not what is under test.
  await page.evaluate(() => {
    window.__blobs = new Map();
    window.__downloads = [];
    const create = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      const url = create(blob);
      window.__blobs.set(url, blob);
      return url;
    };
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      const blob = this.download ? window.__blobs.get(this.href) : null;
      if (blob) {
        window.__downloads.push(
          blob.arrayBuffer().then((b) => ({ name: this.download, type: blob.type, bytes: Array.from(new Uint8Array(b)) })),
        );
        return undefined;
      }
      return click.call(this);
    };
  });
  const button = await page.waitForFunction(
    (name) =>
      [...document.querySelectorAll("button")].find(
        (b) => (b.getAttribute("aria-label") || b.textContent.trim()) === name && !b.disabled,
      ),
    { timeout: STEP_TIMEOUT },
    label,
  );
  await button.asElement().click();
  await page.waitForFunction(() => window.__downloads.length > 0, { timeout: STEP_TIMEOUT });
  const { name, type, bytes } = await page.evaluate(() => window.__downloads[0]);
  if (type !== "application/pdf") throw new Error(`the download is ${type}, not application/pdf`);
  return { name, pdf: Buffer.from(bytes).toString("latin1") };
}

/**
 * Every string the PDF draws, as a reader sees it (ADR-095 O-5). A string in
 * a standard font is a literal `(…) Tj`; one in the embedded Unicode font
 * (Noto Sans) is a run of glyph ids `<…> Tj`, which the font's own ToUnicode
 * CMap maps back to characters. Each hex run is decoded through every CMap in
 * the file; a wrong CMap yields noise, never a false match.
 */
function printedTexts(pdf) {
  const texts = [...pdf.matchAll(/\(((?:[^()\\]|\\.)*)\) Tj/g)].map((m) => m[1].replace(/\\(.)/g, "$1"));
  const cmaps = [...pdf.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)].map((block) => {
    const map = new Map();
    for (const [, gid, uni] of block[1].matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]+)>/gi)) {
      map.set(gid.toLowerCase(), String.fromCharCode(...(uni.match(/.{4}/g) || []).map((u) => parseInt(u, 16))));
    }
    return map;
  });
  for (const [, hex] of pdf.matchAll(/<([0-9a-f]+)> Tj/gi)) {
    const gids = hex.toLowerCase().match(/.{4}/g) || [];
    for (const cmap of cmaps) texts.push(gids.map((g) => cmap.get(g) ?? "�").join(""));
  }
  return texts;
}

/** The checks every rendered certificate must pass. */
function assertCertificatePdf({ name, pdf }, certificateNumber, hash) {
  const problems = [];
  const printed = printedTexts(pdf);
  if (!pdf.startsWith("%PDF-")) problems.push(`not a PDF (starts ${JSON.stringify(pdf.slice(0, 8))})`);
  if (!/\/Subtype \/Image/.test(pdf) || !/\/I\d+ Do/.test(pdf)) problems.push("no QR image drawn");
  if (!printed.includes(certificateNumber)) problems.push("certificate number not printed");
  if (!printed.includes(hash)) problems.push("the v2 integrity hash is not printed");
  if (!/\/FontFile2 /.test(pdf)) problems.push("the Unicode font is not embedded (it fell back to Helvetica)");
  if (name !== `${certificateNumber}.pdf`) problems.push(`saved as ${name}`);
  if (problems.length) throw new Error(problems.join("; "));
  return `${name}, ${pdf.length} bytes, QR + number + v2 hash, Unicode font embedded`;
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
  let approverId = null;
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

  // M-11: a certificate, taken through submit -> approve -> sign (password
  // re-authentication), for the two PDF checks. The seeded operator drafts,
  // submits and signs; a second user APPROVES, because a certificate's author
  // may not approve it (separation of duties).
  const reauth = { authMethod: "password", authPayload: OPERATOR_PASSWORD, meaning: "Browser smoke" };
  const approverRole = (roles.body.data || []).find((r) => r.name === "HEALTHCARE ADMIN");
  if (!approverRole) throw new Error("no HEALTHCARE ADMIN role in GET /roles");
  const approverEmail = `browser-smoke-approver-${stamp}@example.com`;
  const approverTemporary = `Temp-${stamp}-Cc3!`;
  const approverPassword = `Smoke-${stamp}-Dd4!`;
  const approverCreated = await api.httpPost(
    "/users/create",
    {
      tenantId,
      username: `bsappr${stamp}`.slice(0, 20),
      firstName: "Smoke",
      lastName: "Approver",
      email: approverEmail,
      password: approverTemporary,
      roleId: approverRole.id,
    },
    admin,
  );
  if (approverCreated.status !== 201) {
    throw new Error(`creating the smoke approver failed (${approverCreated.status}: ${approverCreated.body?.message})`);
  }
  approverId = approverCreated.body.data.id;
  const approverChanged = { status: await replaceTemporaryPassword(approverEmail, approverTemporary, approverPassword) };
  if (approverChanged.status !== 200) throw new Error(`setting the approver's password failed (${approverChanged.status})`);
  const approverSignIn = await fetch(`${api.API_BASE}/auth/login`, {
    method: "POST",
    headers: api.defaultHeaders,
    body: JSON.stringify({ user: approverEmail, password: approverPassword }),
  });
  const approver = api.authHeader(api.extractToken(await approverSignIn.json()));
  const record = await api.httpPost("/calibration-records", { deviceId, calibrationDate: "2026-09-29" }, admin);
  if (record.status !== 201) throw new Error(`creating the smoke calibration record failed (${record.status})`);
  const cert = await api.httpPost(
    "/certificates",
    { deviceId, calibrationRecordId: record.body.data.id, type: "calibration", summary: `Browser smoke ${stamp}` },
    admin,
  );
  if (cert.status !== 201) throw new Error(`creating the smoke certificate failed (${cert.status})`);
  const certId = cert.body.data.id;
  const certificateNumber = cert.body.data.certificateNumber;
  for (const [step, body] of [
    ["submit", {}],
    ["approve", { ...reauth, authPayload: approverPassword }],
    ["sign", { ...reauth, digitalSignature: Buffer.from(`smoke-${stamp}`).toString("base64"), digitalSignatureKeyId: "smoke" }],
  ]) {
    const res = await api.httpPost(`/certificates/${certId}/${step}`, body, step === "approve" ? approver : admin);
    if (res.status === 409 && step === "approve" && /approval workflow/.test(res.body?.message || "")) {
      // A tenant with a certificate approval workflow (seed-demo installs one,
      // A-203) approves through its steps' roles, not directly. Seed with
      // GET /migration/seeding only, as this header says.
      throw new Error(`certificate approval runs through a workflow on this tenant — run the smoke on a stack seeded without seed-demo (${res.body.message})`);
    }
    if (res.status !== 200) throw new Error(`certificate ${step} failed (${res.status}: ${res.body?.message})`);
  }

  // The administrator-set password is replaced through the API: the forced
  // change-password screen is not one of the four checks.
  // A raw sign-in: the harness's httpPost would try to enrol MFA for a
  // level-10 account, which is the browser's job here.
  const changed = { status: await replaceTemporaryPassword(email, temporary, password) };
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
      // This form's own submit (the public header has forms of its own).
      await page2.click('form:has(#mfa-code) button[type="submit"]');
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

    // ---- 4a: the dashboard renders a certificate PDF in the browser
    await check("certificate PDF: the dashboard renders it in the browser from the backend's document", async () => {
      const doc = await api.httpGet(`/certificates/${certId}/document`, admin);
      if (doc.status !== 200) throw new Error(`GET /certificates/:id/document answered ${doc.status}`);
      await page2.goto(`${FRONTEND_URL}/dashboard/calibration`, { waitUntil: "domcontentloaded" });
      // The tab is in the server-rendered HTML, so it can be clicked before the
      // page hydrates, and that click does nothing: run L (2026-10-02, record
      // 2026-10-02-a346-a348-live-pair-kl) waited 30 s on "Calibration Records"
      // with every request answered. Retried until the certificate shows.
      const tabDeadline = Date.now() + STEP_TIMEOUT;
      for (;;) {
        await clickButton(page2, "Compliance Certificates");
        const shown = await page2
          .waitForFunction((n) => document.body.innerText.includes(n), { timeout: 3000 }, certificateNumber)
          .then(() => true, () => false);
        if (shown) break;
        if (Date.now() > tabDeadline) {
          throw new Error(`certificate ${certificateNumber} not shown on the Compliance Certificates tab`);
        }
      }
      const download = await capturePdfDownload(page2, `Download PDF of certificate ${certificateNumber}`);
      return assertCertificatePdf(download, certificateNumber, doc.body.data.integrity.hash);
    });
    await context2.close();

    // ---- 4b: the public verification page, signed out
    const context3 = await browser.createBrowserContext();
    const page3 = await context3.newPage();
    currentPage = page3;
    await instrument(page3, log);
    await check("certificate PDF: the public verification page says valid and renders the signed certificate's PDF", async () => {
      // A-293 (ADR-100): without the certificate's verification token the public
      // endpoint discloses only the verdict ("minimal"), not the document. The
      // token rides in the printed/QR verifyUrl (`?t=` on the page, `?token=` on
      // the API), so the smoke follows the URL the certificate itself carries.
      const published = await api.httpGet(`/certificates/${certId}/document`, admin);
      const printedUrl = new URL(published.body.data.verifyUrl);
      const token = printedUrl.searchParams.get("t") || printedUrl.searchParams.get("token");
      const query = token ? `?token=${encodeURIComponent(token)}` : "";
      const verify = await api.httpGet(`/certificates/verify/${encodeURIComponent(certificateNumber)}${query}`);
      if (!verify.body?.data?.valid || !verify.body.data.document) {
        throw new Error(
          `the verification endpoint does not report a valid, published certificate (disclosure ${verify.body?.data?.disclosure})`,
        );
      }
      const pageQuery = token ? `?t=${encodeURIComponent(token)}` : "";
      // P10 (ADR-090 follow-up): the public pages default to Indonesian; the
      // smoke reads the English copy, chosen as a visitor would, by the cookie.
      await page3.setCookie({ name: "locale", value: "en", url: FRONTEND_URL });
      await page3.goto(`${FRONTEND_URL}/verify/${encodeURIComponent(certificateNumber)}${pageQuery}`, {
        waitUntil: "domcontentloaded",
      });
      // The verdict copy since the P10 restyle: frontend/src/i18n/messages/en.ts "verify.validLead".
      await page3.waitForFunction(
        () => document.body.innerText.includes("This certificate is on the issuer's records, signed, and currently in force."),
        { timeout: STEP_TIMEOUT },
      );
      const download = await capturePdfDownload(page3, "Download certificate PDF");
      return assertCertificatePdf(download, certificateNumber, verify.body.data.integrity.hash);
    });
    await context3.close();

    // ---- 5: CSP and page errors across everything visited
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
    // The run outlives a short access token (two TOTP waits; a stack with
    // JWT_ACCESS_EXPIRED=60s): sign in again, or the clean-up 401s silently
    // and leaves the operator and device behind.
    const again = await api.httpPost("/auth/login", { user: OPERATOR, password: OPERATOR_PASSWORD }).catch(() => null);
    const cleanup = again && api.extractToken(again.body) ? api.authHeader(api.extractToken(again.body)) : admin;
    if (deviceId) await api.httpDelete(`/calibration-devices/${deviceId}`, cleanup).catch(() => {});
    if (operatorId) await api.httpDelete(`/users/delete?userId=${operatorId}`, cleanup).catch(() => {});
    if (approverId) await api.httpDelete(`/users/delete?userId=${approverId}`, cleanup).catch(() => {});
  }

  if (log.httpErrors.length) {
    console.log(`\n  HTTP errors the pages received (informational):\n    ${log.httpErrors.join("\n    ")}`);
  }
  const passed = results.filter((r) => r.ok).length;
  // Seven checks: the MFA flow is two (enrol, then sign in with a code), and
  // the certificate PDF is two (dashboard, public verification page).
  const EXPECTED = 7;
  const ok = !failed && passed === EXPECTED;
  console.log(`\n${passed}/${EXPECTED} checks passed in ${Date.now() - started} ms${ok ? "" : " — FAILED"}`);
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error(`Browser smoke could not run: ${err.message}`);
  process.exit(2);
});
