/**
 * A-16 — is `req.ip` the client?
 *
 * req.ip is what sessions.ip_address, audit_logs.ipAddress,
 * e_signature_records.ipAddress and the per-IP auth limiter record. It is
 * derived by Express from X-Forwarded-For under `trust proxy`, which index.js
 * sets to TRUST_PROXY_HOPS. The deployment's half of the contract (nginx
 * overwrites X-Forwarded-For with the edge-resolved address; the Next proxy
 * forwards exactly that one entry) is in deploy/compose/nginx/*.conf and
 * frontend src/lib/clientIp.ts, with their own tests.
 *
 * What is real: Express, its `trust proxy` resolution and a real HTTP round
 * trip on the loopback interface, using the application's own
 * TRUST_PROXY_HOPS. What is not: nginx and Next.js — the requests below are
 * the ones they send.
 */

const fs = require("fs");
const http = require("http");
const path = require("path");
const express = require("express");
const { TRUST_PROXY_HOPS } = require("../../constants");

let server;
let port;

beforeAll(async () => {
  const app = express();
  app.set("trust proxy", TRUST_PROXY_HOPS);
  app.get("/ip", (req, res) => res.json({ ip: req.ip }));
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  ({ port } = server.address());
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

/** GET /ip with `headers`; resolve the req.ip the app saw. */
const ipSeen = (headers = {}) =>
  new Promise((resolve, reject) => {
    http
      .get({ host: "127.0.0.1", port, path: "/ip", headers }, (res) => {
        let body = "";
        res.on("data", (chunk) => {
          body += chunk;
        });
        res.on("end", () => resolve(JSON.parse(body).ip));
      })
      .on("error", reject);
  });

describe("A-16: the backend's client address", () => {
  it("req.ip is the client address forwarded by the trusted proxy chain", async () => {
    // What nginx (socket.io, uploads) and the Next proxy (/api) both send: one
    // entry, the client address resolved at the edge.
    expect(await ipSeen({ "X-Forwarded-For": "203.0.113.9" })).toBe("203.0.113.9");
    expect(await ipSeen({ "X-Forwarded-For": "2001:db8::7" })).toBe("2001:db8::7");
  });

  it("a client-supplied X-Forwarded-For cannot choose req.ip", async () => {
    // Were a proxy to APPEND rather than overwrite, the client's own value sits
    // on the left. Only the rightmost entry — written by the adjacent proxy —
    // is trusted, so the forged one is ignored.
    expect(await ipSeen({ "X-Forwarded-For": "6.6.6.6, 203.0.113.9" })).toBe("203.0.113.9");
    expect(
      await ipSeen({ "X-Forwarded-For": "6.6.6.6, 7.7.7.7, 203.0.113.9" }),
    ).toBe("203.0.113.9");
  });

  it("no other address header is read", async () => {
    expect(
      await ipSeen({
        "CF-Connecting-IP": "6.6.6.6",
        "X-Real-IP": "6.6.6.6",
        Forwarded: "for=6.6.6.6",
      }),
    ).toBe("127.0.0.1");
  });

  it("trusts exactly one hop, and index.js applies it", () => {
    expect(TRUST_PROXY_HOPS).toBe(1);
    const index = fs.readFileSync(path.join(__dirname, "../../../index.js"), "utf8");
    expect(index).toContain('app.set("trust proxy", TRUST_PROXY_HOPS);');
    expect(index.match(/app\.set\("trust proxy"/g)).toHaveLength(1);
  });
});
