/**
 * A real HTTP webhook receiver, in-process (A-10).
 *
 * It verifies every request exactly as docs/WEBHOOK/03-WEBHOOK-SECURITY.md
 * tells a receiver to — the recipe is `verifyWebhook` below, and it is the
 * code the document quotes — so a test that uses it proves the signature a
 * real receiver checks, over real sockets, not the shape of a mocked fetch.
 *
 *   const rx = await startReceiver({ secret });
 *   // point a webhook at rx.url, deliver, then:
 *   rx.received  // [{ deliveryId, event, body, verdict }]
 *   rx.respondWith(500)  // the status the next requests get
 *   await rx.close();
 */
const crypto = require("crypto");
const http = require("http");

/** Reject a timestamp more than this far from the receiver's clock. */
const TOLERANCE_SECONDS = 300;

/**
 * The receiver-side verification recipe.
 *
 * @param {string} secret - the webhook's signing secret (64 hex chars)
 * @param {Object} headers - lower-cased request headers
 * @param {string} rawBody - the body bytes exactly as received
 * @param {Set<string>} seen - delivery ids already accepted
 * @param {number} [nowSeconds]
 * @returns {"ok"|"duplicate"|"bad-signature"|"stale"|"missing-headers"}
 */
const verifyWebhook = (secret, headers, rawBody, seen, nowSeconds = Math.floor(Date.now() / 1000)) => {
  const timestamp = headers["x-webhook-timestamp"];
  const signature = headers["x-webhook-signature"];
  const deliveryId = headers["x-webhook-delivery"];
  if (!timestamp || !signature || !deliveryId) {
    return "missing-headers";
  }
  // 1. Freshness first: a replayed request carries an old timestamp.
  if (!/^\d+$/.test(timestamp) || Math.abs(nowSeconds - Number(timestamp)) > TOLERANCE_SECONDS) {
    return "stale";
  }
  // 2. The signature covers `${timestamp}.${body}`, so the timestamp cannot be
  //    swapped for a fresh one without the secret.
  const expected = `v1=${crypto.createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex")}`;
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return "bad-signature";
  }
  // 3. At-least-once delivery: the same id can arrive twice. Process it once.
  if (seen.has(deliveryId)) {
    return "duplicate";
  }
  seen.add(deliveryId);
  return "ok";
};

/**
 * @param {{secret: string, status?: number}} opts
 * @returns {Promise<Object>} { url, received, respondWith, advanceClock, replay, close }
 */
const startReceiver = async ({ secret, status = 200 }) => {
  const seen = new Set();
  const received = [];
  let nextStatus = status;
  let clockOffset = 0;
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      const now = Math.floor(Date.now() / 1000) + clockOffset;
      const verdict = verifyWebhook(secret, req.headers, body, seen, now);
      received.push({
        deliveryId: req.headers["x-webhook-delivery"],
        event: req.headers["x-webhook-event"],
        headers: req.headers,
        body,
        verdict,
      });
      const code = verdict === "ok" || verdict === "duplicate" ? nextStatus : 401;
      res.writeHead(code, { "Content-Type": "text/plain" });
      res.end(verdict);
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const url = `http://127.0.0.1:${port}/hook`;
  return {
    url,
    received,
    respondWith: (s) => {
      nextStatus = s;
    },
    // Move the receiver's clock, e.g. to replay a capture ten minutes later.
    advanceClock: (seconds) => {
      clockOffset += seconds;
    },
    // Re-send a captured request byte-for-byte, headers included — what an
    // attacker who recorded it would do. `freshTimestamp` swaps in the
    // receiver's current time WITHOUT re-signing (the attacker has no secret).
    replay: async (i, { freshTimestamp = false } = {}) => {
      const r = received[i];
      const headers = { ...r.headers };
      delete headers["content-length"];
      delete headers.host;
      delete headers.connection;
      if (freshTimestamp) {
        headers["x-webhook-timestamp"] = String(Math.floor(Date.now() / 1000) + clockOffset);
      }
      const res = await fetch(url, { method: "POST", headers, body: r.body });
      return res.text();
    },
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
};

module.exports = { startReceiver, verifyWebhook, TOLERANCE_SECONDS };
