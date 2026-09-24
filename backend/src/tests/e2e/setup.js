/**
 * E2E test setup — shared utilities for browser-based (HTTP) tests.
 * Uses Node 24 native fetch for making requests against the running API server.
 *
 * This is the correct tool for API E2E testing — no browser rendering needed,
 * just real HTTP requests against the live server.
 */
const { BASE_URL = "http://localhost:5000" } = process.env;
const API_BASE = `${BASE_URL}/api/v1`;

const defaultHeaders = {
  "Content-Type": "application/json",
  "User-Agent": "Callibrator-E2E-Test/1.0 (Node24 Native Fetch)",
};

/**
 * Wait for the server to be ready.
 */
async function waitForServer(retries = 30, delayMs = 1000) {
  for (let i = 0; i < retries; i++) {
    try {
      const resp = await fetch(BASE_URL, { signal: AbortSignal.timeout(3000) });
      if (resp.ok) {
        console.log(`  [E2E] Server ready at ${BASE_URL}`);
        return true;
      }
    } catch {
      // Server not ready yet
    }
    console.log(`  [E2E] Waiting for server... attempt ${i + 1}/${retries}`);
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(
    `Server at ${BASE_URL} not ready after ${retries} attempts`
  );
}

/**
 * Make a GET request.
 */
async function httpGet(path, headers = {}) {
  const url = `${API_BASE}${path}`;
  const startTime = Date.now();

  const resp = await fetch(url, {
    method: "GET",
    headers: { ...defaultHeaders, ...headers },
    signal: AbortSignal.timeout(15000),
  });

  let body = null;
  const ct = resp.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    body = await resp.json().catch(() => null);
  }

  return {
    status: resp.status,
    body,
    headers: Object.fromEntries(resp.headers),
    elapsed: Date.now() - startTime,
  };
}

// ============================================================
// P6-07 — THE SUPER ADMIN SIGNS IN WITH A SECOND FACTOR
//
// Since P6-07 a platform operator (the seeded sys@mail.com every spec signs in
// as) without MFA gets an ENROLMENT-ONLY session: everything but MFA
// enrolment answers 403 MFA_ENROLMENT_REQUIRED. With MFA, the password step
// answers `data.mfaRequired` and a short-lived token, and the session comes
// from POST /auth/mfa/login.
//
// So that the ~55 specs need no change, `httpPost("/auth/login", …)` completes
// that for them, here and only here:
//   - `data.mfaEnrolmentRequired` → enrol: /auth/mfa/setup, then
//     /auth/mfa/verify with a code computed from the returned secret; then
//     sign in again;
//   - `data.mfaRequired` → /auth/mfa/login with a computed code;
//   and hands the spec the final login response, shaped as before.
//
// The secret, the last TOTP step used and the last session are kept in a
// state file (E2E_MFA_STATE_FILE, default in the OS temp directory, one per
// identifier), because a TOTP code is accepted ONCE per 30-second step
// (A-115): a spec that signs in inside the same step as the one before reuses
// the cached session — checked live with /auth/verify first, since some specs
// sign sessions out — instead of waiting for the next step.
//
// A database whose super admin already has MFA the state file does not know
// cannot be signed into: set E2E_SUPERADMIN_TOTP_SECRET, or reset the
// operator's MFA with src/scripts/breakGlassMfaReset.js.
// ============================================================

const nodeCrypto = require("crypto");
const nodeFs = require("fs");
const nodeOs = require("os");
const nodePath = require("path");

const TOTP_STEP_MS = 30 * 1000;
const SESSION_REUSE_MS = Number(process.env.E2E_SESSION_REUSE_MS || 10 * 60 * 1000);
const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** RFC 4648 base32 → bytes. */
function base32Decode(secret) {
  let bits = "";
  for (const ch of String(secret).replace(/=+$/, "").toUpperCase()) {
    const value = BASE32.indexOf(ch);
    if (value < 0) {
      throw new Error("E2E: the TOTP secret is not base32");
    }
    bits += value.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

/** RFC 6238 TOTP (SHA-1, 30 s, 6 digits) — what the backend's otplib checks. */
function totpAt(secret, step) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = nodeCrypto.createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = mac[mac.length - 1] & 0xf;
  const value =
    ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(value % 1000000).padStart(6, "0");
}

function mfaStateFile(identifier) {
  if (process.env.E2E_MFA_STATE_FILE) {
    return process.env.E2E_MFA_STATE_FILE;
  }
  const id = nodeCrypto.createHash("sha256").update(String(identifier).toLowerCase()).digest("hex");
  return nodePath.join(nodeOs.tmpdir(), `callibrator-e2e-mfa-${id.slice(0, 16)}.json`);
}

function readMfaState(identifier) {
  try {
    return JSON.parse(nodeFs.readFileSync(mfaStateFile(identifier), "utf8"));
  } catch {
    return {};
  }
}

function writeMfaState(identifier, state) {
  nodeFs.writeFileSync(mfaStateFile(identifier), JSON.stringify(state), { mode: 0o600 });
}

/**
 * A code for a step the account has not used: the backend accepts now±1 step
 * and refuses a step at or before the last one used. Waits for the next step
 * only when all three are spent.
 */
async function nextTotp(identifier, secret) {
  for (;;) {
    const state = readMfaState(identifier);
    const now = Math.floor(Date.now() / TOTP_STEP_MS);
    const last = Number.isInteger(state.lastStep) ? state.lastStep : -1;
    const step = [now - 1, now, now + 1].find((s) => s > last);
    if (step !== undefined) {
      writeMfaState(identifier, { ...state, secret, lastStep: step });
      return totpAt(secret, step);
    }
    await new Promise((resolve) => setTimeout(resolve, TOTP_STEP_MS - (Date.now() % TOTP_STEP_MS) + 50));
  }
}

async function rawPost(path, data, headers = {}) {
  const resp = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { ...defaultHeaders, ...headers },
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(15000),
  });
  const ct = resp.headers.get("content-type") || "";
  const body = ct.includes("application/json") ? await resp.json().catch(() => null) : null;
  return { status: resp.status, body, headers: Object.fromEntries(resp.headers) };
}

/** Finish a password sign-in that asked for (or must first enrol) MFA. */
async function completeMfaSignIn(credentials, first) {
  const identifier = credentials.user || credentials.email || credentials.username;
  let response = first;

  if (response.body?.data?.mfaEnrolmentRequired && response.body?.token) {
    const bearer = { Authorization: `Bearer ${response.body.token}` };
    const setup = await rawPost("/auth/mfa/setup", {}, bearer);
    const secret = setup.body?.data?.secret;
    if (setup.status !== 200 || !secret) {
      throw new Error(`E2E: MFA enrolment of ${identifier} failed at setup (${setup.status})`);
    }
    writeMfaState(identifier, { secret });
    const verify = await rawPost("/auth/mfa/verify", { code: await nextTotp(identifier, secret) }, bearer);
    if (verify.status !== 200) {
      throw new Error(`E2E: MFA enrolment of ${identifier} failed at verify (${verify.status})`);
    }
    response = await rawPost("/auth/login", credentials);
  }

  if (response.body?.data?.mfaRequired && response.body?.token) {
    const secret = process.env.E2E_SUPERADMIN_TOTP_SECRET || readMfaState(identifier).secret;
    if (!secret) {
      throw new Error(
        `E2E: ${identifier} has MFA but no secret is known — set E2E_SUPERADMIN_TOTP_SECRET, ` +
          "or reset the operator's MFA with src/scripts/breakGlassMfaReset.js",
      );
    }
    const mfa = await rawPost("/auth/mfa/login", {
      token: response.body.token,
      code: await nextTotp(identifier, secret),
    });
    if (mfa.status === 200) {
      writeMfaState(identifier, {
        ...readMfaState(identifier),
        session: { body: mfa.body, headers: mfa.headers, at: Date.now() },
      });
    }
    return mfa;
  }
  return response;
}

/** A recent session for these credentials that the server still accepts. */
async function reusableSession(credentials) {
  const identifier = credentials.user || credentials.email || credentials.username;
  const { session } = readMfaState(identifier);
  if (!session || Date.now() - session.at > SESSION_REUSE_MS || !session.body?.token) {
    return null;
  }
  const alive = await rawPost("/auth/verify", {}, { Authorization: `Bearer ${session.body.token}` });
  return alive.status === 200 ? { status: 200, body: session.body, headers: session.headers } : null;
}

/**
 * Make a POST request.
 */
async function httpPost(path, data = {}, headers = {}) {
  if (path === "/auth/login" && data && typeof data.password === "string") {
    const startTime = Date.now();
    const reused = await reusableSession(data);
    if (reused) {
      return { ...reused, elapsed: Date.now() - startTime };
    }
    const first = await rawPost(path, data, headers);
    const done =
      first.status === 200 && (first.body?.data?.mfaRequired || first.body?.data?.mfaEnrolmentRequired)
        ? await completeMfaSignIn(data, first)
        : first;
    return { ...done, elapsed: Date.now() - startTime };
  }

  const url = `${API_BASE}${path}`;
  const startTime = Date.now();

  const resp = await fetch(url, {
    method: "POST",
    headers: { ...defaultHeaders, ...headers },
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(15000),
  });

  let body = null;
  const ct = resp.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    body = await resp.json().catch(() => null);
  }

  return {
    status: resp.status,
    body,
    headers: Object.fromEntries(resp.headers),
    elapsed: Date.now() - startTime,
  };
}

/**
 * Make a PUT request.
 */
async function httpPut(path, data = {}, headers = {}) {
  const url = `${API_BASE}${path}`;
  const startTime = Date.now();

  const resp = await fetch(url, {
    method: "PUT",
    headers: { ...defaultHeaders, ...headers },
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(15000),
  });

  let body = null;
  const ct = resp.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    body = await resp.json().catch(() => null);
  }

  return {
    status: resp.status,
    body,
    headers: Object.fromEntries(resp.headers),
    elapsed: Date.now() - startTime,
  };
}

/**
 * Make a DELETE request.
 */
async function httpDelete(path, headers = {}) {
  const url = `${API_BASE}${path}`;
  const startTime = Date.now();

  const resp = await fetch(url, {
    method: "DELETE",
    headers: { ...defaultHeaders, ...headers },
    signal: AbortSignal.timeout(15000),
  });

  let body = null;
  const ct = resp.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    body = await resp.json().catch(() => null);
  }

  return {
    status: resp.status,
    body,
    headers: Object.fromEntries(resp.headers),
    elapsed: Date.now() - startTime,
  };
}

/**
 * Make an OPTIONS (CORS preflight) request.
 */
async function httpOptions(path, headers = {}) {
  const url = `${API_BASE}${path}`;

  const resp = await fetch(url, {
    method: "OPTIONS",
    headers: {
      ...defaultHeaders,
      "Origin": BASE_URL,
      "Access-Control-Request-Method": "POST",
      ...headers,
    },
    signal: AbortSignal.timeout(5000),
  });

  return {
    status: resp.status,
    headers: Object.fromEntries(resp.headers),
  };
}

/**
 * Extract token from a login response body.
 */
function extractToken(body) {
  if (!body) return null;
  return body.token || (body.data && body.data.token) || null;
}

/**
 * Extract refresh token from a login response body.
 */
function extractRefreshToken(body) {
  if (!body) return null;
  return body.refreshToken || (body.data && body.data.refreshToken) || null;
}

/**
 * Build auth header.
 */
function authHeader(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

module.exports = {
  BASE_URL,
  API_BASE,
  httpGet,
  httpPost,
  httpPut,
  httpDelete,
  httpOptions,
  extractToken,
  extractRefreshToken,
  authHeader,
  waitForServer,
  defaultHeaders,
};
