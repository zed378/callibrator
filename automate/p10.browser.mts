#!/usr/bin/env node
/**
 * P10-13 (AC-1, AC-2, AC-9, AC-10, AC-12) — the Phase 10 public surface in a
 * real browser: the landing, identifier-first sign-in, the first-sign-in
 * password change for a one-time password, request access, the invitation,
 * forgot/reset, the verification page, and PASSKEYS — registered and used
 * through Chrome's WebAuthn virtual authenticator (the DevTools protocol's
 * `WebAuthn` domain: ctap2, resident keys, user verification).
 *
 * TypeScript, run by Node itself (type stripping, Node ≥ 23.6; the repo pins
 * 26): `node automate/p10.browser.mts`. Only erasable syntax (no enums, no
 * parameter properties), checked by `automate/tsconfig.json`:
 *   node node_modules/@typescript/native/bin/tsc -p automate/tsconfig.json
 * Dependencies are the repository's own: puppeteer-core, axe-core, and the
 * E2E harness (backend/src/tests/e2e/setup.js) for the operator's session.
 *
 * It runs against a RUNNING stack, like automate/smoke.browser.js: the
 * frontend (FRONTEND_URL), the backend API (BASE_URL), seeded with
 * GET /api/v1/migration/seeding, whose mail goes to Mailpit (E2E_MAILPIT_URL):
 * the invitation link and the reset code exist only in an email.
 *
 *   FRONTEND_URL=http://localhost:27131 BASE_URL=http://127.0.0.1:27130 \
 *   E2E_MAILPIT_URL=http://127.0.0.1:27132 E2E_OPERATOR_PASSWORD=… \
 *     node automate/p10.browser.mts
 *
 * FRONTEND_URL must be the origin the backend's WEBAUTHN_ORIGIN names, on the
 * host WEBAUTHN_RP_ID names (localhost: a secure context over http), or every
 * passkey ceremony is refused — correctly.
 *
 * Environment: FRONTEND_URL, BASE_URL, E2E_MAILPIT_URL, E2E_OPERATOR,
 * E2E_OPERATOR_PASSWORD (+ E2E_BOOTSTRAP_PASSWORD on a fresh stack),
 * CHROME_PATH, HEADFUL=1, P10_ARTIFACTS=<dir> (failure screenshots), and for
 * the in-browser SSO check P10_MOCK_IDP_HOST (the host name the backend
 * reaches this machine by, e.g. host.docker.internal) + P10_MOCK_IDP_PORT
 * (default 27139). That check needs a NON-production backend whose
 * SSRF_DEV_ALLOW_HOSTS names the host: a production backend refuses a
 * private or http identity provider (it is reported as skipped without it).
 *
 * Exit status 0 only when every check passed. Not part of `make verify`.
 */
import { createRequire } from "node:module";
import { createHash, generateKeyPairSync, randomBytes, sign as cryptoSign } from "node:crypto";
import type { KeyObject } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import puppeteer from "puppeteer-core";
import type { Browser, BrowserContext, CDPSession, ElementHandle, Page } from "puppeteer-core";

const require = createRequire(import.meta.url);
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));

const FRONTEND_URL = (process.env["FRONTEND_URL"] ?? "http://localhost:3001").replace(/\/$/, "");
process.env["BASE_URL"] = process.env["BASE_URL"] ?? "http://localhost:3000";
const BACKEND_ORIGIN = new URL(process.env["BASE_URL"]).origin;
const MAILPIT = (process.env["E2E_MAILPIT_URL"] ?? "").replace(/\/$/, "");
/**
 * The in-browser SSO check's mock OIDC identity provider (an HTTP server in
 * THIS process). P10_MOCK_IDP_HOST is the host name the BACKEND reaches this
 * machine by (`host.docker.internal` for a compose stack); unset, the check is
 * skipped by name. The backend reaches a non-public IdP only when it is NOT in
 * production and the host is on SSRF_DEV_ALLOW_HOSTS (utils/ssrf.util.ts): in
 * production a private or http IdP is refused, correctly.
 */
const MOCK_IDP_HOST = process.env["P10_MOCK_IDP_HOST"] ?? "";
const MOCK_IDP_PORT = Number(process.env["P10_MOCK_IDP_PORT"] ?? "27139");
const MOCK_IDP_ORIGIN = `http://localhost:${String(MOCK_IDP_PORT)}`;
const STEP_TIMEOUT = 30000;
/**
 * Q-42 (ADR-113): the intake opens only with a published privacy notice. The
 * stack sets PRIVACY_NOTICE_URL on BOTH services (scripts/ci/e2e-env.sh and
 * deploy/compose/docker-compose.e2e.yml); this is the value it set.
 */
const PRIVACY_NOTICE_URL = process.env["E2E_PRIVACY_NOTICE_URL"] ?? "https://example.com/privacy-notice";
const ARTIFACTS = process.env["P10_ARTIFACTS"] ?? os.tmpdir();

/** The E2E harness (JavaScript), as this file uses it. */
interface Harness {
  API_BASE: string;
  OPERATOR: string;
  OPERATOR_PASSWORD: string;
  httpPost: (path: string, body: unknown, headers?: Record<string, string>) => Promise<{ status: number; body: unknown }>;
  extractToken: (body: unknown) => string | null;
}
const api = require(path.join(here, "../backend/src/tests/e2e/setup.js")) as Harness;
const AXE_SOURCE = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

// ---------------------------------------------------------------- the dictionaries

/** `"key": "value"` lines of frontend/src/i18n/messages/<locale>.ts — the words the pages show. */
const dictionary = (locale: "id" | "en"): Map<string, string> => {
  const source = fs.readFileSync(path.join(here, `../frontend/src/i18n/messages/${locale}.ts`), "utf8");
  const words = new Map<string, string>();
  for (const m of source.matchAll(/^\s*"([a-zA-Z0-9_.]+)":\s*\n?\s*"((?:[^"\\]|\\.)*)"/gm)) {
    words.set(m[1] ?? "", JSON.parse(`"${m[2] ?? ""}"`) as string);
  }
  return words;
};
const ID = dictionary("id");
const EN = dictionary("en");
const t = (words: Map<string, string>, key: string): string => {
  const value = words.get(key);
  if (value === undefined) {
    throw new Error(`no dictionary entry ${key}`);
  }
  return value;
};

// ---------------------------------------------------------------- small helpers

const obj = (v: unknown): Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const stamp = `${Date.now().toString(36)}${randomBytes(3).toString("hex")}`;
const strong = (label: string): string => `P10br-${label}-${randomBytes(4).toString("hex")}Aa1`;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface Reply {
  status: number;
  body: unknown;
}

/** One backend call (JSON), never throwing on a status. */
const call = async (method: string, route: string, body?: unknown, token?: string, extra: Record<string, string> = {}): Promise<Reply> => {
  const headers: Record<string, string> = { "Content-Type": "application/json", "User-Agent": "Callibrator-E2E-P10-Browser/1.0", ...extra };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const init: RequestInit = { method, headers, signal: AbortSignal.timeout(20000) };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await fetch(`${api.API_BASE}${route}`, init);
  const json: unknown = (res.headers.get("content-type") ?? "").includes("json") ? await res.json().catch(() => null) : null;
  return { status: res.status, body: json };
};
const dataOf = (r: Reply): Record<string, unknown> => obj(obj(r.body)["data"]);

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

// ---------------------------------------------------------------- mail

const decodeEntities = (html: string): string =>
  html
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

/** The newest mail to `to` since `since` matching `pattern` (Mailpit HTTP API). */
const waitForMail = async (to: string, pattern: RegExp, since: number): Promise<RegExpExecArray> => {
  if (MAILPIT === "") throw new Error("E2E_MAILPIT_URL is not set: the mailed secret cannot be read");
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    const found = obj(await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}&limit=20`)).json());
    for (const m of (Array.isArray(found["messages"]) ? (found["messages"] as unknown[]) : []).map(obj)) {
      if (Date.parse(str(m["Created"])) + 2000 < since) continue;
      const full = obj(await (await fetch(`${MAILPIT}/api/v1/message/${str(m["ID"])}`)).json());
      const match = pattern.exec(decodeEntities(`${str(full["HTML"])}\n${str(full["Text"])}`));
      if (match) return match;
    }
    await sleep(750);
  }
  throw new Error(`no mail to ${to} matching ${String(pattern)} within 45 s`);
};

// ---------------------------------------------------------------- the run's record

interface Log {
  violations: string[];
  pageErrors: string[];
  thirdParty: string[];
  documents: { url: string; csp: string }[];
}
const log: Log = { violations: [], pageErrors: [], thirdParty: [], documents: [] };
const results: { name: string; ok: boolean; detail: string }[] = [];
let currentPage: Page | null = null;

const check = async (name: string, fn: () => Promise<string>): Promise<boolean> => {
  const started = Date.now();
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail });
    console.log(`  PASS  ${name} (${String(Date.now() - started)} ms)${detail ? ` — ${detail}` : ""}`);
    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    results.push({ name, ok: false, detail: message });
    console.log(`  FAIL  ${name} (${String(Date.now() - started)} ms) — ${message}`);
    if (currentPage && !currentPage.isClosed()) {
      const shot = path.join(ARTIFACTS, `p10-browser-failure-${String(Date.now())}.png`);
      await currentPage.screenshot({ path: shot as `${string}.png`, fullPage: true }).catch(() => undefined);
      const text = await currentPage.evaluate(() => document.body.innerText).catch(() => "");
      console.log(`        at ${currentPage.url()}; screenshot ${shot}`);
      console.log(`        page text: ${text.replace(/\s+/g, " ").slice(0, 400)}`);
    }
    return false;
  }
};

/** Record CSP violations, page errors, third-party requests and each document's CSP. */
const instrument = async (page: Page): Promise<void> => {
  page.on("pageerror", (err) => {
    log.pageErrors.push(`${page.url()}: ${err instanceof Error ? err.message : String(err)}`);
  });
  page.on("console", (msg) => {
    if (/Content[- ]Security[- ]Policy/i.test(msg.text())) log.violations.push(`${page.url()}: ${msg.text()}`);
  });
  page.on("request", (req) => {
    const url = req.url();
    if (!/^https?:/.test(url)) return;
    const origin = new URL(url).origin;
    // The mock IdP is local (this process), and only the SSO check navigates to it.
    if (origin !== new URL(FRONTEND_URL).origin && origin !== BACKEND_ORIGIN && !(MOCK_IDP_HOST !== "" && origin === MOCK_IDP_ORIGIN)) {
      log.thirdParty.push(`${req.method()} ${url} (on ${page.url()})`);
    }
  });
  page.on("response", (res) => {
    // A redirect (3xx) has no page, so no policy to carry: only rendered documents are checked.
    if (res.request().resourceType() === "document" && res.url().startsWith(FRONTEND_URL) && (res.status() < 300 || res.status() >= 400)) {
      log.documents.push({ url: res.url(), csp: res.headers()["content-security-policy"] ?? "" });
    }
  });
  await page.evaluateOnNewDocument(() => {
    document.addEventListener("securitypolicyviolation", (e) => {
      console.error(`Content Security Policy violation: ${e.violatedDirective} ${e.blockedURI}`);
    });
  });
};

const newPage = async (context: BrowserContext): Promise<Page> => {
  const page = await context.newPage();
  await instrument(page);
  currentPage = page;
  return page;
};

/** axe, WCAG 2.1 A/AA: the violations, `id — targets`. */
const axe = async (page: Page, label: string): Promise<string> => {
  await page.waitForNetworkIdle({ idleTime: 400, timeout: 6000 }).catch(() => undefined);
  const has = await page.evaluate(() => typeof (window as unknown as { axe?: unknown }).axe !== "undefined");
  if (!has) await page.evaluate(AXE_SOURCE);
  const violations = await page.evaluate(async () => {
    const w = window as unknown as {
      axe: { run: (ctx: Document, o: unknown) => Promise<{ violations: { id: string; nodes: { target: string[] }[] }[] }> };
    };
    const res = await w.axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
      resultTypes: ["violations"],
    });
    return res.violations.map((v) => `${v.id} — ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
  });
  if (violations.length > 0) throw new Error(`axe (${label}): ${violations.join("; ")}`);
  return `${label}: axe 0`;
};

/**
 * Exactly one <main> and one visible <h1> (AC-2).
 *
 * Polled, not sampled once: the landing streams its content behind a
 * Suspense skeleton that has no <h1>, and React reveals a streamed boundary
 * a moment after `domcontentloaded`. Run M (2026-10-02, record
 * 2026-10-02-a346-a348-live-pair-kl) read "1 <main>, 0 visible <h1>" 340 ms
 * in, on a page whose screenshot shows the heading. The verdict is the same
 * check, given until the step timeout to hold.
 */
const landmarks = async (page: Page): Promise<void> => {
  const read = () =>
    page.evaluate(() => ({
      mains: document.querySelectorAll("main").length,
      h1s: [...document.querySelectorAll("h1")].filter((h) => h.getBoundingClientRect().height > 0).length,
    }));
  const deadline = Date.now() + STEP_TIMEOUT;
  let seen = await read();
  while ((seen.mains !== 1 || seen.h1s !== 1) && Date.now() < deadline) {
    await sleep(250);
    seen = await read();
  }
  if (seen.mains !== 1 || seen.h1s !== 1) throw new Error(`${page.url()}: ${String(seen.mains)} <main>, ${String(seen.h1s)} visible <h1>`);
};

const go = async (page: Page, route: string): Promise<void> => {
  await page.goto(`${FRONTEND_URL}${route}`, { waitUntil: "domcontentloaded", timeout: STEP_TIMEOUT });
  await page.waitForSelector("main h1", { timeout: STEP_TIMEOUT });
};

const textIncludes = async (page: Page, text: string, timeout = STEP_TIMEOUT): Promise<void> => {
  await page.waitForFunction((s: string) => document.body.innerText.includes(s), { timeout }, text);
};

const clickText = async (page: Page, selector: string, text: string): Promise<void> => {
  const handle = await page.waitForFunction(
    (sel: string, label: string) =>
      [...document.querySelectorAll<HTMLElement>(sel)].find(
        (b) => (b.getAttribute("aria-label") ?? b.textContent ?? "").trim().includes(label) && !(b as HTMLButtonElement).disabled,
      ) ?? null,
    { timeout: STEP_TIMEOUT },
    selector,
    text,
  );
  await (handle as ElementHandle<HTMLElement>).click();
};

/** Click the first VISIBLE element matching `selector` (a header control may be duplicated for small screens). */
const clickVisible = async (page: Page, selector: string): Promise<void> => {
  const handle = await page.waitForFunction(
    (sel: string) =>
      [...document.querySelectorAll<HTMLElement>(sel)].find((e) => {
        const r = e.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== "hidden";
      }) ?? null,
    { timeout: STEP_TIMEOUT },
    selector,
  );
  await (handle as ElementHandle<HTMLElement>).click();
};

/** Type into a field until it holds exactly `value` (keystrokes before hydration are lost). */
const typeExactly = async (page: Page, selector: string, value: string): Promise<void> => {
  for (let attempt = 0; attempt < 5; attempt++) {
    await page.click(selector, { count: 3 });
    await page.keyboard.press("Backspace");
    await page.type(selector, value);
    if ((await page.$eval(selector, (e) => (e as HTMLInputElement).value)) === value) return;
    await sleep(500);
  }
  throw new Error(`${selector} never held the typed value`);
};

/** Identifier first, then the password step (retried until hydrated). */
const identifierThenPassword = async (page: Page, identifier: string, password: string): Promise<void> => {
  await go(page, "/login");
  await page.waitForSelector("#username", { timeout: STEP_TIMEOUT });
  await typeExactly(page, "#username", identifier);
  for (let attempt = 1; !(await page.$("#password")); attempt++) {
    await page.click('form:has(#username) button[type="submit"]');
    const shown = await page
      .waitForSelector("#password", { visible: true, timeout: attempt < 3 ? 5000 : STEP_TIMEOUT })
      .then(() => true)
      .catch(() => false);
    if (shown) break;
    if (attempt >= 3) throw new Error("the password step never appeared after the identifier");
  }
  await typeExactly(page, "#password", password);
  await Promise.all([
    page.waitForResponse((r) => new URL(r.url()).pathname.endsWith("/auth/login"), { timeout: STEP_TIMEOUT }),
    page.click('form:has(#password) button[type="submit"]'),
  ]);
};

const onDashboard = async (page: Page): Promise<string> => {
  await page.waitForFunction(() => location.pathname.startsWith("/dashboard"), { timeout: STEP_TIMEOUT });
  return new URL(page.url()).pathname;
};

// ---------------------------------------------------------------- WebAuthn (CDP)

interface VirtualCredential {
  credentialId: string;
  isResidentCredential: boolean;
  rpId?: string;
  privateKey: string;
  userHandle?: string;
  signCount: number;
}

/** A CTAP2 platform authenticator with resident keys and user verification, on this page. */
const addAuthenticator = async (page: Page): Promise<{ cdp: CDPSession; id: string }> => {
  const cdp = await page.createCDPSession();
  await cdp.send("WebAuthn.enable", { enableUI: false });
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return { cdp, id: authenticatorId };
};

const credentialsOf = async (a: { cdp: CDPSession; id: string }): Promise<VirtualCredential[]> =>
  (await a.cdp.send("WebAuthn.getCredentials", { authenticatorId: a.id })).credentials as VirtualCredential[];

/** A fresh browser context whose authenticator holds exactly `credential`. */
const contextWithPasskey = async (
  browser: Browser,
  credential: VirtualCredential,
): Promise<{ context: BrowserContext; page: Page; current: () => Promise<VirtualCredential> }> => {
  const context = await browser.createBrowserContext();
  const page = await newPage(context);
  const a = await addAuthenticator(page);
  await a.cdp.send("WebAuthn.addCredential", { authenticatorId: a.id, credential });
  // The credential as the authenticator now holds it: its signature counter
  // moves with every assertion, and the server refuses a counter that goes
  // back (a cloned authenticator), so the next context must start from here.
  const current = async (): Promise<VirtualCredential> => {
    const [held] = await credentialsOf(a);
    if (!held) throw new Error("the virtual authenticator lost the credential");
    return held;
  };
  return { context, page, current };
};

/** /login → the passkey button; resolves with the verify response's status. */
const passkeySignIn = async (page: Page): Promise<number> => {
  await go(page, "/login");
  const label = t(ID, "auth.login.passkey");
  const verify = page.waitForResponse((r) => new URL(r.url()).pathname.endsWith("/auth/passkey/verify"), { timeout: STEP_TIMEOUT });
  // Retried until hydrated: a click before hydration does nothing.
  for (let attempt = 0; attempt < 5; attempt++) {
    await clickText(page, "button", label);
    const answered = await Promise.race([verify.then(() => true), sleep(4000).then(() => false)]);
    if (answered) break;
  }
  return (await verify).status();
};

// ---------------------------------------------------------------- the certificate for /verify

const issueSignedCertificate = async (token: string, tenantId: string): Promise<{ number: string; verifyPath: string; serial: string }> => {
  const roles = await call("GET", "/roles?limit=100", undefined, token);
  const approverRole = (Array.isArray(obj(roles.body)["data"]) ? (obj(roles.body)["data"] as unknown[]) : [])
    .map(obj)
    .find((r) => r["name"] === "HEALTHCARE ADMIN");
  if (!approverRole) throw new Error("no HEALTHCARE ADMIN role");
  const approverEmail = `p10br-appr-${stamp}@example.com`;
  const once = strong("once");
  const approverPassword = strong("appr");
  const created = await call(
    "POST",
    "/users/create",
    { tenantId, username: `p10brappr${stamp}`.slice(0, 30), firstName: "Browser", lastName: "Approver", email: approverEmail, password: once, roleId: approverRole["id"] },
    token,
  );
  if (created.status !== 201) throw new Error(`approver create ${String(created.status)}`);
  const first = await call("POST", "/auth/login", { user: approverEmail, password: once });
  await call("POST", "/auth/first-sign-in/password", { token: str(obj(first.body)["token"]), newPassword: approverPassword });
  const approver = str(obj((await call("POST", "/auth/login", { user: approverEmail, password: approverPassword })).body)["token"]);
  const serial = `P10BR-${stamp}`;
  const device = await call("POST", "/calibration-devices", { name: `P10 Browser Device ${stamp}`, manufacturer: "P10", model: "B-1", serialNumber: serial, status: "active" }, token);
  const record = await call("POST", "/calibration-records", { deviceId: dataOf(device)["id"], calibrationDate: "2026-09-29" }, token);
  const cert = await call(
    "POST",
    "/certificates",
    { deviceId: dataOf(device)["id"], calibrationRecordId: dataOf(record)["id"], type: "calibration", summary: `P10 browser ${stamp}` },
    token,
  );
  if (cert.status !== 201) throw new Error(`certificate create ${String(cert.status)}`);
  const id = str(dataOf(cert)["id"]);
  const reauth = { authMethod: "password", authPayload: api.OPERATOR_PASSWORD, meaning: "P10-13 browser" };
  const steps: [string, Record<string, unknown>, string][] = [
    ["submit", {}, token],
    ["approve", { ...reauth, authPayload: approverPassword }, approver],
    ["sign", { ...reauth, digitalSignature: Buffer.from(`p10br-${stamp}`).toString("base64"), digitalSignatureKeyId: "p10br" }, token],
  ];
  for (const [step, body, as] of steps) {
    const res = await call("POST", `/certificates/${id}/${step}`, body, as);
    if (res.status !== 200) throw new Error(`certificate ${step} ${String(res.status)}: ${str(obj(res.body)["message"])}`);
  }
  const doc = await call("GET", `/certificates/${id}/document`, undefined, token);
  // What the QR code carries: CERT_VERIFY_BASE_URL/<number>?t=<token>.
  const qr = new URL(str(dataOf(doc)["verifyUrl"]), "http://x.invalid");
  return { number: str(dataOf(cert)["certificateNumber"]), verifyPath: qr.search === "" ? "" : `${qr.pathname}${qr.search}`, serial };
};

// ---------------------------------------------------------------- the mock OIDC identity provider

interface MockIdp {
  /** The issuer and the base the backend uses (discovery, token, JWKS): http://<MOCK_IDP_HOST>:<port>. */
  issuer: string;
  clientId: string;
  clientSecret: string;
  /** The redirect URIs the client was registered with (the IdP refuses any other). */
  redirectUris: Set<string>;
  /** The person who signs in at the IdP (auto-consent: the check is the relying party, not the IdP's UI). */
  subject: { email: string; givenName: string; familyName: string };
  /** What the IdP saw, for the assertions. */
  seen: { authorize: number; token: number; jwks: number; discovery: number; pkceVerified: boolean };
  close: () => Promise<void>;
}

const b64url = (buf: Buffer): string => buf.toString("base64url");

/**
 * A minimal OpenID Provider: discovery, an authorization endpoint that signs
 * the configured subject in at once (code flow, PKCE S256 required, the
 * registered redirect URI only), a token endpoint (client secret + PKCE
 * checked), and a JWKS. The id_token is RS256 with `iss`, `aud`, `nonce`,
 * `exp`, `iat`, `sub` and `email`. The AUTHORIZATION endpoint is published on
 * localhost (the browser goes there); discovery, token and JWKS on
 * MOCK_IDP_HOST (the backend's server-side calls).
 */
const startMockIdp = async (): Promise<MockIdp> => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const kid = `p10-${stamp}`;
  const jwk = { ...(publicKey.export({ format: "jwk" }) as Record<string, string>), kid, use: "sig", alg: "RS256" };
  const idp: MockIdp = {
    // A path per run: the backend caches discovery and the JWKS by URL (6 h) and does not refetch on
    // an unknown `kid` (A-341), so a second run's new signing key would be refused under the same URL.
    issuer: `http://${MOCK_IDP_HOST}:${String(MOCK_IDP_PORT)}/${stamp}`,
    clientId: `p10-client-${stamp}`,
    clientSecret: randomBytes(24).toString("hex"),
    redirectUris: new Set<string>(),
    subject: { email: "", givenName: "Sso", familyName: "Browser" },
    seen: { authorize: 0, token: 0, jwks: 0, discovery: 0, pkceVerified: false },
    close: async () => undefined,
  };
  const codes = new Map<string, { redirectUri: string; nonce: string; challenge: string; clientId: string }>();
  const signJwt = (payload: Record<string, unknown>, key: KeyObject): string => {
    const head = b64url(Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid })));
    const body = b64url(Buffer.from(JSON.stringify(payload)));
    return `${head}.${body}.${b64url(cryptoSign("sha256", Buffer.from(`${head}.${body}`), key))}`;
  };
  const json = (res: http.ServerResponse, status: number, value: unknown): void => {
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(value));
  };
  const server = http.createServer((req, res) => {
    const raw = new URL(req.url ?? "/", "http://idp.invalid");
    // Everything lives under /<stamp> (the issuer's path); anything else is not this run's IdP.
    if (!raw.pathname.startsWith(`/${stamp}/`)) {
      res.writeHead(404);
      res.end();
      return;
    }
    const url = new URL(raw.pathname.slice(stamp.length + 1) + raw.search, "http://idp.invalid");
    if (req.method === "GET" && url.pathname === "/.well-known/openid-configuration") {
      idp.seen.discovery++;
      json(res, 200, {
        issuer: idp.issuer,
        authorization_endpoint: `${MOCK_IDP_ORIGIN}/${stamp}/authorize`,
        token_endpoint: `${idp.issuer}/token`,
        jwks_uri: `${idp.issuer}/jwks`,
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
        code_challenge_methods_supported: ["S256"],
      });
      return;
    }
    if (req.method === "GET" && url.pathname === "/jwks") {
      idp.seen.jwks++;
      json(res, 200, { keys: [jwk] });
      return;
    }
    if (req.method === "GET" && url.pathname === "/authorize") {
      idp.seen.authorize++;
      const p = url.searchParams;
      const redirectUri = p.get("redirect_uri") ?? "";
      if (p.get("client_id") !== idp.clientId || !idp.redirectUris.has(redirectUri) || p.get("response_type") !== "code" ||
        p.get("code_challenge_method") !== "S256" || !p.get("code_challenge") || !p.get("state") || !p.get("nonce")) {
        res.writeHead(400, { "Content-Type": "text/plain" });
        res.end("invalid authorization request");
        return;
      }
      const code = randomBytes(24).toString("base64url");
      codes.set(code, { redirectUri, nonce: p.get("nonce") ?? "", challenge: p.get("code_challenge") ?? "", clientId: idp.clientId });
      const back = new URL(redirectUri);
      back.searchParams.set("code", code);
      back.searchParams.set("state", p.get("state") ?? "");
      res.writeHead(302, { Location: back.toString() });
      res.end();
      return;
    }
    if (req.method === "POST" && url.pathname === "/token") {
      idp.seen.token++;
      let raw = "";
      req.on("data", (chunk: Buffer) => { raw += chunk.toString("utf8"); });
      req.on("end", () => {
        const f = new URLSearchParams(raw);
        const grant = codes.get(f.get("code") ?? "");
        codes.delete(f.get("code") ?? "");
        const verifier = f.get("code_verifier") ?? "";
        const pkceOk = grant !== undefined && b64url(createHash("sha256").update(verifier).digest()) === grant.challenge;
        if (!grant || f.get("grant_type") !== "authorization_code" || f.get("client_id") !== idp.clientId ||
          f.get("client_secret") !== idp.clientSecret || f.get("redirect_uri") !== grant.redirectUri || !pkceOk) {
          json(res, 400, { error: "invalid_grant" });
          return;
        }
        idp.seen.pkceVerified = true;
        const now = Math.floor(Date.now() / 1000);
        const idToken = signJwt(
          {
            iss: idp.issuer, aud: idp.clientId, sub: `sub-${stamp}`, email: idp.subject.email,
            given_name: idp.subject.givenName, family_name: idp.subject.familyName,
            nonce: grant.nonce, iat: now, exp: now + 300, auth_time: now,
          },
          privateKey,
        );
        json(res, 200, { access_token: randomBytes(16).toString("hex"), token_type: "Bearer", expires_in: 300, id_token: idToken });
      });
      return;
    }
    res.writeHead(404);
    res.end();
  });
  // Every interface: the backend container reaches this machine through the Docker host gateway.
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(MOCK_IDP_PORT, "0.0.0.0", () => resolve());
  });
  console.log(`  mock OIDC IdP on :${String((server.address() as AddressInfo).port)} (issuer ${idp.issuer}, authorize ${MOCK_IDP_ORIGIN})`);
  idp.close = () => new Promise<void>((resolve) => server.close(() => resolve()));
  return idp;
};

// ---------------------------------------------------------------- run

const main = async (): Promise<void> => {
  const started = Date.now();
  console.log(`P10 browser suite — frontend ${FRONTEND_URL}, API ${BACKEND_ORIGIN}, mail ${MAILPIT || "(none)"}`);

  const signIn = await api.httpPost("/auth/login", { user: api.OPERATOR, password: api.OPERATOR_PASSWORD });
  const operator = api.extractToken(signIn.body);
  if (signIn.status !== 200 || !operator) throw new Error(`API sign-in as ${api.OPERATOR} failed (${String(signIn.status)})`);
  const operatorTenant = str(obj(obj(signIn.body)["data"])["tenantId"]);

  const browser = await puppeteer.launch({
    executablePath: chromePath(),
    headless: !process.env["HEADFUL"],
    args: ["--no-first-run", "--no-default-browser-check"],
  });

  // State that flows between checks.
  const org = `RS Browser ${stamp}`;
  const admin = { email: `p10br-admin-${stamp}@rs-browser-${stamp}.example.com`, password: strong("admin"), requestId: "" };
  let approvedAt = 0;
  const passkeys: { a?: VirtualCredential; b?: VirtualCredential } = {};

  try {
    // ---- landing
    const c1 = await browser.createBrowserContext();
    const p1 = await newPage(c1);
    await check("landing: one <main> and <h1>, lang=id, axe 0; the EN toggle switches the language and back", async () => {
      await go(p1, "/");
      await landmarks(p1);
      const idTitle = t(ID, "landing.hero.title");
      if ((await p1.evaluate(() => document.documentElement.lang)) !== "id") throw new Error("the landing is not lang=id by default");
      await textIncludes(p1, idTitle);
      // Q-42: the footer links to the published notice, by its Indonesian name.
      const footerPrivacy = await p1.$$eval(`footer a[href="${PRIVACY_NOTICE_URL}"]`, (links) => links.map((a) => (a.textContent ?? "").trim()));
      if (!footerPrivacy.includes(t(ID, "pub.footer.privacy"))) {
        throw new Error(`the footer has no "${t(ID, "pub.footer.privacy")}" link to ${PRIVACY_NOTICE_URL} — does the stack set PRIVACY_NOTICE_URL (Q-42)?`);
      }
      const axeId = await axe(p1, "/ (id)");
      await Promise.all([p1.waitForNavigation({ timeout: STEP_TIMEOUT }).catch(() => undefined), clickVisible(p1, 'button[lang="en"]')]);
      await p1.waitForFunction(() => document.documentElement.lang === "en", { timeout: STEP_TIMEOUT });
      await textIncludes(p1, t(EN, "landing.hero.title"));
      await landmarks(p1);
      const axeEn = await axe(p1, "/ (en)");
      await Promise.all([p1.waitForNavigation({ timeout: STEP_TIMEOUT }).catch(() => undefined), clickVisible(p1, 'button[lang="id"]')]);
      await p1.waitForFunction(() => document.documentElement.lang === "id", { timeout: STEP_TIMEOUT });
      return `${axeId}; ${axeEn}`;
    });

    // ---- request access
    await check("request access: an empty submit is an alert listing the fields (axe 0); a filled form shows the success state; the request is queued", async () => {
      await go(p1, "/request-access");
      await landmarks(p1);
      const axeEmpty = await axe(p1, "/request-access (empty)");
      if (!(await p1.$("#ra-consent"))) {
        throw new Error("/request-access shows no form — the stack must set PRIVACY_NOTICE_URL on the frontend (Q-42, ADR-113)");
      }
      // Q-42: the consent names the notice and links to it.
      if (!(await p1.$(`label[for="ra-consent"] a[href="${PRIVACY_NOTICE_URL}"][target="_blank"]`))) {
        throw new Error(`the consent does not link to ${PRIVACY_NOTICE_URL}`);
      }
      for (let attempt = 0; attempt < 5 && !(await p1.$('[role="alert"]')); attempt++) {
        await p1.click('form:has(#ra-consent) button[type="submit"]');
        await sleep(800);
      }
      await p1.waitForSelector('[role="alert"]', { timeout: STEP_TIMEOUT });
      const axeError = await axe(p1, "/request-access (errors)");
      await p1.type("#ra-organisationName", org);
      await p1.click("#ra-facilityType-hospital");
      await p1.type("#ra-city", "Bandung");
      await p1.select("#ra-deviceCountBand", "100_499");
      await p1.type("#ra-contactName", "Siti Rahma");
      await p1.type("#ra-workEmail", admin.email);
      await p1.type("#ra-whatsapp", "0812 3456 7890");
      await p1.click("#ra-consent");
      const answered = p1.waitForResponse((r) => new URL(r.url()).pathname.endsWith("/access-requests"), { timeout: STEP_TIMEOUT });
      await p1.click('form:has(#ra-consent) button[type="submit"]');
      const res = await answered;
      if (res.status() !== 202) throw new Error(`the intake answered ${String(res.status())}`);
      await textIncludes(p1, t(ID, "access.success.title"));
      await p1.waitForSelector('[role="status"] h1', { timeout: STEP_TIMEOUT });
      await landmarks(p1);
      const axeDone = await axe(p1, "/request-access (success)");
      const queue = await call("GET", "/admin/access-requests?status=pending&limit=100", undefined, operator);
      const row = (Array.isArray(obj(queue.body)["data"]) ? (obj(queue.body)["data"] as unknown[]) : [])
        .map(obj)
        .find((r) => r["workEmail"] === admin.email);
      if (!row) throw new Error("the request is not in the pending queue");
      admin.requestId = str(row["id"]);
      return `${axeEmpty}; ${axeError}; ${axeDone}; queued`;
    });
    await c1.close();

    // ---- invitation
    const c2 = await browser.createBrowserContext();
    const p2 = await newPage(c2);
    await check("invitation: approve → the mailed link sets the password; the token leaves the address bar; /login?status=invited", async () => {
      approvedAt = Date.now();
      const approved = await call("POST", `/admin/access-requests/${admin.requestId}/approve`, { tenantCode: `P10BR${stamp}`.toUpperCase().slice(0, 40) }, operator);
      if (approved.status !== 200) throw new Error(`approve answered ${String(approved.status)}: ${str(obj(approved.body)["message"])}`);
      const match = await waitForMail(admin.email, /(\/invitation\?token=[A-Za-z0-9_\-%.~]+)/, approvedAt);
      await go(p2, match[1] ?? "");
      await p2.waitForFunction(() => !location.search.includes("token="), { timeout: STEP_TIMEOUT });
      await landmarks(p2);
      const axeInvite = await axe(p2, "/invitation");
      await p2.type("#invite-password", admin.password);
      await p2.type("#invite-confirm", admin.password);
      const accepted = p2.waitForResponse((r) => new URL(r.url()).pathname.endsWith("/invitation/accept"), { timeout: STEP_TIMEOUT });
      await p2.click('form:has(#invite-password) button[type="submit"]');
      if ((await accepted).status() !== 200) throw new Error("the invitation accept was refused");
      await p2.waitForFunction(() => location.pathname === "/login" && location.search.includes("status=invited"), { timeout: STEP_TIMEOUT });
      await p2.waitForSelector('[role="status"]', { timeout: STEP_TIMEOUT });
      return axeInvite;
    });

    // ---- identifier-first password sign-in, and the passkeys
    await check("sign-in: identifier first, then the password step, lands the new administrator on the dashboard", async () => {
      await identifierThenPassword(p2, admin.email, admin.password);
      return onDashboard(p2);
    });

    await check("passkeys: two passkeys registered on /dashboard/webauthn, each on its own virtual authenticator", async () => {
      const register = async (name: string): Promise<VirtualCredential> => {
        const a = await addAuthenticator(p2);
        await p2.goto(`${FRONTEND_URL}/dashboard/webauthn`, { waitUntil: "domcontentloaded" });
        await p2.waitForSelector('input[placeholder="e.g. Work laptop"]', { timeout: STEP_TIMEOUT });
        await p2.type('input[placeholder="e.g. Work laptop"]', name);
        const verified = p2.waitForResponse((r) => new URL(r.url()).pathname.endsWith("/webauthn/verify-registration"), { timeout: STEP_TIMEOUT });
        await clickText(p2, "button", passkeys.a ? "Add Another Passkey" : "Register This Device");
        const res = await verified;
        if (res.status() !== 200) throw new Error(`registering ${name}: verify-registration answered ${String(res.status())}`);
        const [credential] = await credentialsOf(a);
        if (!credential?.isResidentCredential) throw new Error(`${name} is not a resident (discoverable) credential`);
        await a.cdp.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId: a.id });
        await textIncludes(p2, name);
        return credential;
      };
      passkeys.a = await register(`Key A ${stamp}`);
      passkeys.b = await register(`Key B ${stamp}`);
      return "2 passkeys, both resident, both listed on the page";
    });
    await c2.close();

    for (const which of ["a", "b"] as const) {
      await check(`passkey sign-in with Key ${which.toUpperCase()}: no identifier typed, the dashboard opens`, async () => {
        const credential = passkeys[which];
        if (!credential) throw new Error("the passkey was not registered");
        const { context, page, current } = await contextWithPasskey(browser, credential);
        try {
          const status = await passkeySignIn(page);
          passkeys[which] = await current();
          if (status !== 200) throw new Error(`passkey verify answered ${String(status)}`);
          return `${await onDashboard(page)} (signature counter now ${String(passkeys[which]?.signCount)})`;
        } finally {
          await context.close();
        }
      });
    }

    await check("revoke Key A with the password; Key A is then refused at sign-in and Key B still works", async () => {
      const b = passkeys.b;
      const a = passkeys.a;
      if (!a || !b) throw new Error("the passkeys were not registered");
      const { context, page, current } = await contextWithPasskey(browser, b);
      try {
        const bStatus = await passkeySignIn(page);
        passkeys.b = await current();
        if (bStatus !== 200) throw new Error(`Key B did not sign in (${String(bStatus)})`);
        await onDashboard(page);
        await page.goto(`${FRONTEND_URL}/dashboard/webauthn`, { waitUntil: "domcontentloaded" });
        await clickText(page, "button", `Remove passkey Key A ${stamp}`);
        await page.waitForSelector('[role="dialog"] input[type="password"]', { timeout: STEP_TIMEOUT });
        await page.type('[role="dialog"] input[type="password"]', admin.password);
        const revoked = page.waitForResponse(
          (r) => r.request().method() === "DELETE" && /\/webauthn\/credentials\//.test(new URL(r.url()).pathname),
          { timeout: STEP_TIMEOUT },
        );
        await clickText(page, '[role="dialog"] button', "Remove Passkey");
        if ((await revoked).status() !== 200) throw new Error("the revoke was refused");
        await page.waitForFunction((n: string) => !document.body.innerText.includes(n), { timeout: STEP_TIMEOUT }, `Key A ${stamp}`);
      } finally {
        await context.close();
      }
      const refused = await contextWithPasskey(browser, a);
      let refusedStatus = 0;
      try {
        refusedStatus = await passkeySignIn(refused.page);
        await sleep(1500);
        if (new URL(refused.page.url()).pathname.startsWith("/dashboard")) throw new Error("a revoked passkey reached the dashboard");
        await refused.page.waitForSelector('[role="alert"]', { timeout: STEP_TIMEOUT });
      } finally {
        await refused.context.close();
      }
      if (refusedStatus !== 401) throw new Error(`the revoked passkey got ${String(refusedStatus)}, not 401`);
      const again = await contextWithPasskey(browser, passkeys.b);
      try {
        if ((await passkeySignIn(again.page)) !== 200) throw new Error("Key B stopped working after Key A was revoked");
        await onDashboard(again.page);
      } finally {
        await again.context.close();
      }
      return "Key A → 401 and an alert; Key B → dashboard";
    });

    // ---- a one-time password: the first sign-in asks for a new one
    const c3 = await browser.createBrowserContext();
    const p3 = await newPage(c3);
    await check("one-time password: the first sign-in asks for a new password (axe 0), then signs in with it", async () => {
      const roles = await call("GET", "/roles?limit=100", undefined, operator);
      const userRole = (Array.isArray(obj(roles.body)["data"]) ? (obj(roles.body)["data"] as unknown[]) : []).map(obj).find((r) => r["name"] === "USER");
      if (!userRole) throw new Error("no USER role");
      const email = `p10br-once-${stamp}@example.com`;
      const once = strong("once");
      const created = await call(
        "POST",
        "/users/create",
        { tenantId: operatorTenant, username: `p10bronce${stamp}`.slice(0, 30), firstName: "One", lastName: "Time", email, password: once, roleId: userRole["id"] },
        operator,
      );
      if (created.status !== 201) throw new Error(`user create ${String(created.status)}`);
      await identifierThenPassword(p3, email, once);
      await p3.waitForSelector("#first-new-password", { timeout: STEP_TIMEOUT });
      await textIncludes(p3, t(ID, "auth.first.title"));
      const axeFirst = await axe(p3, "/login (first-sign-in password)");
      const chosen = strong("chosen");
      await typeExactly(p3, "#first-new-password", chosen);
      await typeExactly(p3, "#first-confirm-password", chosen);
      await p3.click('form:has(#first-new-password) button[type="submit"]');
      const where = await onDashboard(p3);
      // The one-time password is spent: it no longer signs in.
      // From its own client address (the backend trusts one hop): a deliberate failure must not
      // spend the shared address's login throttle (5 failures in 15 min, A-185).
      const spent = await call("POST", "/auth/login", { user: email, password: once }, undefined, {
        "X-Forwarded-For": `198.18.${String(randomBytes(1)[0] ?? 1)}.${String((randomBytes(1)[0] ?? 0) % 250 + 1)}`,
      });
      if (spent.status !== 401) throw new Error(`the spent one-time password answered ${String(spent.status)}`);
      return `${axeFirst}; ${where}`;
    });
    await c3.close();

    // ---- forgot / reset
    const c4 = await browser.createBrowserContext();
    const p4 = await newPage(c4);
    await check("forgot/reset: the neutral sentence, the mailed code, a new password, /login?status=reset, and sign-in with it (axe 0, both steps)", async () => {
      await go(p4, "/forgot-password");
      await landmarks(p4);
      const axe1 = await axe(p4, "/forgot-password (email)");
      const sentAt = Date.now();
      await p4.type("#reset-email", admin.email);
      for (let attempt = 0; attempt < 5 && !(await p4.$("#reset-otp")); attempt++) {
        await p4.click('form:has(#reset-email) button[type="submit"]');
        await p4.waitForSelector("#reset-otp", { timeout: 5000 }).catch(() => undefined);
      }
      await textIncludes(p4, t(ID, "reset.sent"));
      const axe2 = await axe(p4, "/forgot-password (code)");
      const code = (await waitForMail(admin.email, />\s*(\d{6})\s*</, sentAt))[1] ?? "";
      admin.password = strong("reset");
      await p4.type("#reset-otp", code);
      await p4.type("#reset-password", admin.password);
      await p4.click('form:has(#reset-otp) button[type="submit"]');
      await p4.waitForFunction(() => location.pathname === "/login" && location.search.includes("status=reset"), { timeout: STEP_TIMEOUT });
      await p4.waitForSelector('[role="status"]', { timeout: STEP_TIMEOUT });
      await identifierThenPassword(p4, admin.email, admin.password);
      return `${axe1}; ${axe2}; ${await onDashboard(p4)}`;
    });
    await c4.close();

    // ---- verification page
    const c5 = await browser.createBrowserContext();
    const p5 = await newPage(c5);
    await check("verify: the QR link shows SAH with the device; an unknown number shows TIDAK DITEMUKAN (axe 0 both)", async () => {
      const cert = await issueSignedCertificate(operator, operatorTenant);
      if (cert.verifyPath === "") throw new Error("the certificate's verifyUrl carries no token");
      await go(p5, cert.verifyPath);
      await textIncludes(p5, t(ID, "verify.valid"));
      await textIncludes(p5, cert.serial);
      await landmarks(p5);
      const axeValid = await axe(p5, "/verify (valid, token)");
      await go(p5, `/verify/CERT-NOPE-${stamp}`);
      await textIncludes(p5, t(ID, "verify.notFound"));
      await landmarks(p5);
      const axeMissing = await axe(p5, "/verify (not found)");
      return `${axeValid}; ${axeMissing}`;
    });
    await c5.close();

    // ---- identifier-first SSO through a real redirect (OIDC, the mock IdP in this process)
    const ssoName = "sso: identifier-first, a claimed domain → the IdP (OIDC, code + PKCE) → back signed in on /dashboard; the callback is single-use";
    if (MOCK_IDP_HOST === "") {
      console.log(`  SKIP  ${ssoName} — P10_MOCK_IDP_HOST is not set (a non-production stack whose SSRF_DEV_ALLOW_HOSTS names that host)`);
    } else {
      const idp = await startMockIdp();
      const c6 = await browser.createBrowserContext();
      const p6 = await newPage(c6);
      try {
        await check(ssoName, async () => {
          const code = `P10BRSSO${stamp}`.toUpperCase().slice(0, 40);
          const domain = `sso-br-${stamp}.example.com`;
          const created = await call("POST", "/tenants/create", { name: `SSO Browser ${stamp}`, code, email: `it@${domain}` }, operator);
          if (created.status !== 201) throw new Error(`tenant create ${String(created.status)}: ${str(obj(created.body)["message"])}`);
          const tenantId = str(dataOf(created)["id"]);
          const redirectUri = `${FRONTEND_URL}/api/v1/auth/sso/oidc/callback/${code}`;
          idp.redirectUris.add(redirectUri);
          const settings = await call(
            "PATCH",
            "/tenants/settings",
            {
              tenantId,
              settings: {
                sso_enabled: "true",
                oidc_client_id: idp.clientId,
                oidc_client_secret: idp.clientSecret,
                oidc_authority: idp.issuer,
                oidc_redirect_uri: redirectUri,
              },
            },
            operator,
          );
          if (settings.status !== 200) throw new Error(`SSO settings ${String(settings.status)}: ${str(obj(settings.body)["message"])}`);
          const claim = await call("PUT", `/admin/tenants/${tenantId}/sso-domains`, { domains: [domain] }, operator);
          if (claim.status !== 200) throw new Error(`domain claim ${String(claim.status)}: ${str(obj(claim.body)["message"])}`);
          // The person exists only at the IdP: the first sign-in provisions them just in time (USER role,
          // audited SSO_JIT_PROVISION). (An administrator-created account would land on the forced
          // password change first — A-123 — which is not what this check is about.)
          idp.subject.email = `sso-person-${stamp}@${domain}`;

          let callbackUrl = "";
          p6.on("request", (r) => {
            if (r.url().includes(`/sso/oidc/callback/${code}?`)) callbackUrl = r.url();
          });
          await go(p6, "/login");
          await p6.waitForSelector("#username", { timeout: STEP_TIMEOUT });
          await typeExactly(p6, "#username", idp.subject.email);
          // Retried until hydrated; the discovery answer sends the browser to the IdP.
          for (let attempt = 0; attempt < 5 && idp.seen.authorize === 0; attempt++) {
            await p6.click('form:has(#username) button[type="submit"]').catch(() => undefined);
            await sleep(2500);
          }
          const where = await onDashboard(p6);
          if (where !== "/dashboard") throw new Error(`the SSO sign-in landed on ${where}, not the dashboard`);
          if (idp.seen.authorize < 1 || idp.seen.token < 1 || !idp.seen.pkceVerified) {
            throw new Error(`the IdP saw authorize ${String(idp.seen.authorize)}, token ${String(idp.seen.token)}, PKCE ${String(idp.seen.pkceVerified)}`);
          }
          const who = await p6.evaluate(async () => {
            const r = await fetch("/api/v1/auth/verify", { method: "POST" });
            return { status: r.status, body: (await r.json().catch(() => null)) as { data?: { email?: string; tenantId?: string } } | null };
          });
          if (who.status !== 200 || who.body?.data?.email !== idp.subject.email || who.body.data.tenantId !== tenantId) {
            throw new Error(`/auth/verify in the browser answered ${String(who.status)} for ${String(who.body?.data?.email)}`);
          }
          // The callback (IdP code + state) is single-use: replayed in a fresh context it is refused to /login.
          if (callbackUrl === "") throw new Error("the browser never reached the OIDC callback");
          const c7 = await browser.createBrowserContext();
          try {
            const p7 = await newPage(c7);
            await p7.goto(callbackUrl, { waitUntil: "domcontentloaded", timeout: STEP_TIMEOUT });
            await p7.waitForFunction(() => location.pathname === "/login" && location.search.includes("error="), { timeout: STEP_TIMEOUT });
          } finally {
            await c7.close();
            currentPage = p6;
          }
          return `${where} as ${idp.subject.email} (provisioned just in time); IdP: discovery ${String(idp.seen.discovery)}, authorize ${String(idp.seen.authorize)}, token ${String(idp.seen.token)} (PKCE verified), jwks ${String(idp.seen.jwks)}; replayed callback → /login?error`;
        });
      } finally {
        await c6.close();
        await idp.close();
      }
    }

    // ---- CSP and third parties across the whole run
    await check("CSP: every frontend document carried a nonce policy; 0 violations, 0 page errors, 0 third-party requests", async () => {
      const missing = log.documents.filter((d) => !/script-src[^;]*'nonce-/.test(d.csp));
      const problems = [...missing.map((d) => `no nonce CSP on ${d.url}`), ...log.violations, ...log.pageErrors, ...log.thirdParty];
      if (log.documents.length === 0) problems.push("no frontend document was observed");
      if (problems.length > 0) throw new Error(problems.join("\n        "));
      return `${String(log.documents.length)} documents`;
    });
  } finally {
    await browser.close();
  }

  const passed = results.filter((r) => r.ok).length;
  const ok = passed === results.length && results.length > 0;
  console.log(`\n${String(passed)}/${String(results.length)} checks passed in ${String(Date.now() - started)} ms${ok ? "" : " — FAILED"}`);
  process.exit(ok ? 0 : 1);
};

main().catch((err: unknown) => {
  console.error(`P10 browser suite could not run: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  process.exit(2);
});
