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

/**
 * Make a POST request.
 */
async function httpPost(path, data = {}, headers = {}) {
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
