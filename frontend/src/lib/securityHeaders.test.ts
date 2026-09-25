/**
 * @jest-environment node
 */
// P7-08, ADR-071 — the page CSP of the Next.js content origin.
//
// The expectations are written out by hand, not derived from the builder's own
// tables: a test generated from the code it tests would pass after a directive
// was deleted from both.

import {
  PAGE_SECURITY_HEADERS,
  buildContentSecurityPolicy,
  generateNonce,
} from "./securityHeaders";
import { getScriptNonceFromHeader } from "next/dist/server/app-render/get-script-nonce-from-header";

const NONCE = "AAECAwQFBgcICQoLDA0ODw==";

/** "a b; c d" → { a: ["b"], c: ["d"] } — also fails on a repeated directive. */
const parse = (csp: string): Record<string, string[]> => {
  const out: Record<string, string[]> = {};
  for (const part of csp.split(";").map((p) => p.trim()).filter(Boolean)) {
    const [name, ...sources] = part.split(/\s+/);
    if (name in out) throw new Error(`directive repeated: ${name}`);
    out[name] = sources;
  }
  return out;
};

const prod = (overrides: Partial<Parameters<typeof buildContentSecurityPolicy>[0]> = {}) =>
  parse(
    buildContentSecurityPolicy({
      nonce: NONCE,
      isDev: false,
      host: "kalibrasi.example.com",
      apiBaseUrl: "https://kalibrasi.example.com",
      ...overrides,
    }),
  );

describe("buildContentSecurityPolicy (P7-08)", () => {
  it("scripts: this request's nonce and 'strict-dynamic' — no 'unsafe-inline', no 'unsafe-eval' in production", () => {
    const csp = prod();
    expect(csp["script-src"]).toEqual(["'self'", `'nonce-${NONCE}'`, "'strict-dynamic'"]);
    expect(csp["script-src-attr"]).toEqual(["'none'"]);
    const all = Object.values(csp).flat();
    expect(all).not.toContain("'unsafe-eval'");
    expect(csp["script-src"]).not.toContain("'unsafe-inline'");
  });

  it("Next.js can read the nonce back out of it (the channel the proxy relies on)", () => {
    const header = buildContentSecurityPolicy({ nonce: NONCE, isDev: false });
    // Next's own parser — it takes the FIRST directive starting "script-src",
    // so script-src must precede script-src-attr.
    expect(getScriptNonceFromHeader(header)).toBe(NONCE);
  });

  it("the fixed directives: frame-ancestors, base-uri, form-action, object-src, default-src", () => {
    const csp = prod();
    expect(csp["frame-ancestors"]).toEqual(["'none'"]);
    expect(csp["base-uri"]).toEqual(["'self'"]);
    expect(csp["form-action"]).toEqual(["'self'"]);
    expect(csp["object-src"]).toEqual(["'none'"]);
    expect(csp["default-src"]).toEqual(["'self'"]);
    expect(csp["font-src"]).toEqual(["'self'"]);
  });

  it("styles: <style> elements need the nonce; style attributes stay inline (ADR-071)", () => {
    const csp = prod();
    expect(csp["style-src-elem"]).toEqual(["'self'", `'nonce-${NONCE}'`]);
    expect(csp["style-src-attr"]).toEqual(["'unsafe-inline'"]);
    expect(csp["style-src"]).toEqual(["'self'", "'unsafe-inline'"]);
  });

  it("connect-src: same origin (the /api proxy) and the same-host websocket, both schemes", () => {
    // Production: the API base URL IS the public origin, so its wss:// twin
    // is the same source as the Host one and appears once.
    expect(prod()["connect-src"]).toEqual([
      "'self'",
      "ws://kalibrasi.example.com",
      "wss://kalibrasi.example.com",
      "https://kalibrasi.example.com",
    ]);
  });

  it("connect-src/img-src/frame-src: a separate API origin (development) is named, with its websocket", () => {
    const csp = prod({ host: "localhost:3001", apiBaseUrl: "http://localhost:5000" });
    expect(csp["connect-src"]).toEqual([
      "'self'",
      "ws://localhost:3001",
      "wss://localhost:3001",
      "http://localhost:5000",
      "ws://localhost:5000",
    ]);
    expect(csp["img-src"]).toEqual(["'self'", "data:", "blob:", "http://localhost:5000"]);
    expect(csp["frame-src"]).toEqual(["'self'", "http://localhost:5000"]);
  });

  it("img-src: own images, data: and blob: — no scheme-wide https:", () => {
    const csp = prod({ apiBaseUrl: null });
    expect(csp["img-src"]).toEqual(["'self'", "data:", "blob:"]);
    expect(csp["frame-src"]).toEqual(["'self'"]);
  });

  it("a Host header that is not a host is left out, never reflected", () => {
    for (const host of ["evil.com; script-src *", "a b", "x'y", "", null, undefined]) {
      const csp = prod({ host, apiBaseUrl: null });
      expect(csp["connect-src"]).toEqual(["'self'"]);
      expect(csp["script-src"]).toEqual(["'self'", `'nonce-${NONCE}'`, "'strict-dynamic'"]);
    }
    expect(prod({ host: "[::1]:3000", apiBaseUrl: null })["connect-src"]).toEqual([
      "'self'",
      "ws://[::1]:3000",
      "wss://[::1]:3000",
    ]);
  });

  it("an API base URL that is not http(s) adds nothing", () => {
    for (const apiBaseUrl of ["javascript:alert(1)", "not a url", "ftp://x.example"]) {
      expect(prod({ host: null, apiBaseUrl })["connect-src"]).toEqual(["'self'"]);
    }
  });

  it("development: 'unsafe-eval' for React's error stacks, inline <style> for HMR — still nonce-gated scripts", () => {
    const csp = prod({ isDev: true });
    expect(csp["script-src"]).toEqual(["'self'", `'nonce-${NONCE}'`, "'strict-dynamic'", "'unsafe-eval'"]);
    expect(csp["style-src-elem"]).toEqual(["'self'", "'unsafe-inline'"]);
  });
});

describe("generateNonce", () => {
  it("is 128 bits of base64, and different every time", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const n = generateNonce();
      expect(n).toMatch(/^[A-Za-z0-9+/]{22}==$/);
      expect(Buffer.from(n, "base64")).toHaveLength(16);
      seen.add(n);
    }
    expect(seen.size).toBe(200);
  });
});

describe("PAGE_SECURITY_HEADERS", () => {
  it("nosniff, a referrer policy and a permissions policy — nothing nginx already sends", () => {
    const byKey = Object.fromEntries(PAGE_SECURITY_HEADERS.map((h) => [h.key, h.value]));
    expect(byKey).toEqual({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Permissions-Policy":
        "camera=(), microphone=(), geolocation=(self), payment=(), usb=(), browsing-topics=()",
    });
    // nginx (deploy/compose/nginx/*.conf) adds exactly one header: HSTS.
    expect(Object.keys(byKey)).not.toContain("Strict-Transport-Security");
  });
});
