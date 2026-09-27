/**
 * @jest-environment node
 */
// F-16 — the catch-all proxy buffered every request and response whole
// (`await req.arrayBuffer()`, `await res.arrayBuffer()`), so an upload or a
// download was held in the Next process, twice for an upload. It now streams
// both. F-14 — its upstream fetch had no budget, so a request the browser had
// given up on kept running here; it is now aborted past
// PROXY_UPSTREAM_TIMEOUT_MS without response headers, or when the browser goes.
//
// No fetch mock: the "backend" is a real HTTP server on an ephemeral port, so
// what is asserted is what undici and the proxy actually do on the wire.
// Streaming is proven by ORDER, not by timing: the first chunk must cross the
// proxy while the other end is still deliberately holding the rest back —
// which a buffering proxy cannot do.

import http from "node:http";
import { createHash, randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";

const cookieStore = {
  get: jest.fn(),
  set: jest.fn(),
};

jest.mock("next/headers", () => ({
  cookies: jest.fn(async () => cookieStore),
}));

let mockBackendBase = "";
let mockProxyTimeout = 32000;
jest.mock("@/constants", () => ({
  get API_BASE_URL() {
    return mockBackendBase;
  },
  get PROXY_UPSTREAM_TIMEOUT_MS() {
    return mockProxyTimeout;
  },
}));

import { NextRequest } from "next/server";
import { GET, POST } from "./route";

const CHUNK = 256 * 1024;
const WAIT_MS = 3000;

/** A promise with its resolver, for "the other side has reached this point". */
const signal = () => {
  let fire!: () => void;
  const fired = new Promise<void>((resolve) => {
    fire = resolve;
  });
  return { fire, fired };
};
/** Wait for `p`, or give up after `ms` — the buffering proxy never fires it. */
const within = (p: Promise<void>, ms = WAIT_MS) =>
  Promise.race([p, new Promise<void>((resolve) => setTimeout(resolve, ms))]);

// ── The backend ────────────────────────────────────────────────────────────
let uploadFirstChunk = signal();
let downloadClientHasFirstChunk = signal();
let slowClosed = signal();
let downloadEndedAt = 0;
let seen: { authorization?: string; transferEncoding?: string; expect?: string } = {};
const downloadPart1 = randomBytes(CHUNK);
const downloadPart2 = randomBytes(CHUNK);

const backend = http.createServer((req, res) => {
  seen = {
    authorization: req.headers.authorization,
    transferEncoding: req.headers["transfer-encoding"],
    expect: req.headers.expect,
  };

  if (req.url === "/api/v1/attachments/upload") {
    const hash = createHash("sha256");
    let received = 0;
    req.on("data", (chunk: Buffer) => {
      if (received === 0) uploadFirstChunk.fire();
      received += chunk.length;
      hash.update(chunk);
    });
    req.on("end", () => {
      res.writeHead(201, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true, data: { received, sha256: hash.digest("hex") } }));
    });
    return;
  }

  if (req.url === "/api/v1/attachments/a-1/download") {
    res.writeHead(200, {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": 'attachment; filename="big.bin"',
    });
    res.write(downloadPart1);
    void within(downloadClientHasFirstChunk.fired).then(() => {
      downloadEndedAt = Date.now();
      res.end(downloadPart2);
    });
    return;
  }

  if (req.url === "/api/v1/reports/slow") {
    // Never answers. Records when the proxy lets go of the connection.
    req.on("close", () => slowClosed.fire());
    return;
  }

  if (req.url === "/api/v1/auth/mfa/login") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        success: true,
        data: { id: "u-1" },
        token: "ACCESS.TOKEN.JWT",
        session: { id: "session-1" },
      }),
    );
    return;
  }

  if (req.url === "/api/v1/exports/big.json") {
    // A JSON download: streamed as it is, never parsed here.
    res.writeHead(200, {
      "Content-Type": "application/json",
      "Content-Disposition": 'attachment; filename="export.json"',
    });
    res.end(JSON.stringify({ token: "not-a-session-token", rows: [1, 2, 3] }));
    return;
  }

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end('{"success":true,"data":[]}');
});

const params = (path: string) => ({ params: Promise.resolve({ path: path.split("/") }) });

beforeAll(async () => {
  await new Promise<void>((resolve) => backend.listen(0, "127.0.0.1", resolve));
  mockBackendBase = `http://127.0.0.1:${(backend.address() as AddressInfo).port}`;
});

afterAll(async () => {
  backend.closeAllConnections();
  await new Promise((resolve) => backend.close(resolve));
});

beforeEach(() => {
  jest.clearAllMocks();
  cookieStore.get.mockReturnValue(undefined);
  uploadFirstChunk = signal();
  downloadClientHasFirstChunk = signal();
  slowClosed = signal();
  downloadEndedAt = 0;
  seen = {};
  mockProxyTimeout = 32000;
});

describe("/api/v1/[...path] proxy — bodies stream through (F-16)", () => {
  it("F-16: an upload reaches the backend while the browser is still sending it", async () => {
    const part1 = randomBytes(CHUNK);
    const part2 = randomBytes(CHUNK);
    let backendHasFirstChunk = false;
    void uploadFirstChunk.fired.then(() => {
      backendHasFirstChunk = true;
    });
    let firstChunkBeforeBodyEnded = false;

    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(part1);
        // Hold the rest back until the backend has the first chunk. A proxy
        // that reads the whole body first never lets it get there, and this
        // gives up after WAIT_MS with the flag still false.
        await within(uploadFirstChunk.fired);
        firstChunkBeforeBodyEnded = backendHasFirstChunk;
        controller.enqueue(part2);
        controller.close();
      },
    });

    const res = await POST(
      new NextRequest("http://localhost/api/v1/attachments/upload", {
        method: "POST",
        headers: { "content-type": "application/octet-stream" },
        body,
        duplex: "half",
      } as ConstructorParameters<typeof NextRequest>[1]),
      params("attachments/upload"),
    );

    expect(firstChunkBeforeBodyEnded).toBe(true);
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.data.received).toBe(2 * CHUNK);
    expect(json.data.sha256).toBe(
      createHash("sha256").update(part1).update(part2).digest("hex"),
    );
  });

  it("F-16: a download reaches the browser while the backend is still sending it, byte for byte", async () => {
    const res = await GET(
      new NextRequest("http://localhost/api/v1/attachments/a-1/download"),
      params("attachments/a-1/download"),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="big.bin"');
    expect(res.headers.get("content-type")).toBe("application/octet-stream");

    const reader = res.body!.getReader();
    const chunks: Uint8Array[] = [];
    let got = 0;
    // Read until the first part is here, then let the backend finish.
    while (got < CHUNK) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
    }
    const firstPartBeforeBackendEnded = downloadEndedAt === 0;
    downloadClientHasFirstChunk.fire();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      chunks.push(value);
    }

    expect(firstPartBeforeBackendEnded).toBe(true);
    expect(Buffer.concat(chunks).equals(Buffer.concat([downloadPart1, downloadPart2]))).toBe(true);
  });

  it("F-16: a JSON download is streamed as sent — not parsed, not rewritten", async () => {
    const res = await GET(
      new NextRequest("http://localhost/api/v1/exports/big.json"),
      params("exports/big.json"),
    );

    expect(await res.json()).toEqual({ token: "not-a-session-token", rows: [1, 2, 3] });
    expect(cookieStore.set).not.toHaveBeenCalled();
  });

  it("F-16 keeps A-71: a sign-in answered through the proxy has its token moved to the cookie", async () => {
    const res = await POST(
      new NextRequest("http://localhost/api/v1/auth/mfa/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: "mfa-purpose", code: "123456" }),
      }),
      params("auth/mfa/login"),
    );

    const body = await res.json();
    expect(body).not.toHaveProperty("token");
    expect(JSON.stringify(body)).not.toContain("ACCESS.TOKEN.JWT");
    expect(cookieStore.set).toHaveBeenCalledWith(
      "auth_token",
      "ACCESS.TOKEN.JWT",
      expect.objectContaining({ httpOnly: true }),
    );
  });

  it("F-16: hop-by-hop request headers are not re-sent", async () => {
    await POST(
      new NextRequest("http://localhost/api/v1/things", {
        method: "POST",
        headers: { "content-type": "application/json", expect: "100-continue" },
        body: "{}",
      }),
      params("things"),
    );

    // Reached the backend (undici refuses to send `expect` at all)…
    expect(seen).toHaveProperty("expect");
    // …without it.
    expect(seen.expect).toBeUndefined();
  });

  it("F-16: a caller's Authorization (an API key) is forwarded when there is no session cookie", async () => {
    await GET(
      new NextRequest("http://localhost/api/v1/things", {
        headers: { authorization: "ApiKey ck_live_example" },
      }),
      params("things"),
    );

    expect(seen.authorization).toBe("ApiKey ck_live_example");
  });

  it("F-16: a session cookie's token replaces any Authorization the caller sent", async () => {
    cookieStore.get.mockImplementation((name: string) =>
      name === "auth_token" ? { name, value: "cookie-jwt" } : undefined,
    );

    await GET(
      new NextRequest("http://localhost/api/v1/things", {
        headers: { authorization: "Bearer forged" },
      }),
      params("things"),
    );

    expect(seen.authorization).toBe("Bearer cookie-jwt");
  });
});

describe("/api/v1/[...path] proxy — the upstream budget (F-14)", () => {
  it("F-14: past its budget the proxy aborts the upstream request and answers 504 in the envelope", async () => {
    mockProxyTimeout = 200;

    const res = await GET(
      new NextRequest("http://localhost/api/v1/reports/slow"),
      params("reports/slow"),
    );

    expect(res.status).toBe(504);
    expect(await res.json()).toEqual({
      success: false,
      status: 504,
      message: "The server did not respond in time. Please try again.",
    });
    // The backend sees the connection go — the request is not left running.
    let closed = false;
    await within(slowClosed.fired.then(() => void (closed = true)));
    expect(closed).toBe(true);
  });

  it("F-14: when the browser goes away the upstream request is aborted too", async () => {
    const browser = new AbortController();
    const pending = GET(
      new NextRequest("http://localhost/api/v1/reports/slow", { signal: browser.signal }),
      params("reports/slow"),
    );
    setTimeout(() => browser.abort(), 100);

    let closed = false;
    await within(slowClosed.fired.then(() => void (closed = true)));
    expect(closed).toBe(true);
    // Well inside the 32 s budget: it was the browser, not the timer.
    await pending;
  });
});
