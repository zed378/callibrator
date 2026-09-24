/**
 * clamAv.service — S-04 (the clamd protocol) and S-17 (the verdict cache).
 *
 * Socket mode is exercised over REAL TCP against tests/fixtures/fakeClamd.js,
 * an in-process server that implements clamd's INSTREAM framing as clamd(8)
 * documents it. The previous suites mocked `net` with a socket that answered
 * the invented `STANDBY` command, so they passed against a client no real
 * clamd could talk to. A mock proves the client, not the contract.
 *
 * The real-clamd block at the end runs when CLAMAV_LIVE_PORT names a running
 * clamd (e.g. `docker run -p 13310:3310 clamav/clamav:1.4`).
 *
 * Env consts are read at module load, so each test sets process.env and then
 * re-requires the service (jest.resetModules in beforeEach).
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const EventEmitter = require("events");
const { startFakeClamd, EICAR } = require("../fixtures/fakeClamd");

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

jest.mock("../../utils/circuitBreaker.util", () => ({
  withCircuitBreaker: jest.fn((key, fn) => fn()),
}));

jest.mock("axios", () => ({ post: jest.fn() }), { virtual: true });

const origEnv = { ...process.env };
let tmp;
let clamd;

const write = (name, content) => {
  const p = path.join(tmp, name);
  fs.writeFileSync(p, content);
  return p;
};

const load = (env = {}) => {
  process.env = {
    ...origEnv,
    NODE_ENV: "test",
    CLAMAV_ENABLED: "true",
    CLAMAV_HOST: "127.0.0.1",
    CLAMAV_PORT: String(clamd.port),
    CLAMAV_TIMEOUT: "2000",
    ...env,
  };
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) {delete process.env[k];}
  }
  return require("../../services/clamAv.service");
};

beforeAll(async () => {
  clamd = await startFakeClamd({ streamMaxLength: 256 * 1024 });
});

afterAll(async () => {
  await clamd.close();
});

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "clamav-s04-"));
  clamd.setMode("normal");
  clamd.sessions.length = 0;
});

afterEach(() => {
  process.env = origEnv;
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("S-04 — clamd INSTREAM protocol (fake clamd over TCP)", () => {
  it("a clean file is sent as zINSTREAM, framed, terminated, and reads clean", async () => {
    const svc = load();
    const file = write("clean.txt", "hello, a harmless file\n");

    const result = await svc.scanFile(file, false);

    expect(result).toEqual({ isClean: true, code: "OK", result: "stream: OK" });
    expect(clamd.sessions).toHaveLength(1);
    expect(clamd.sessions[0].command).toBe("zINSTREAM");
    // The server reassembled exactly the file from length-prefixed frames
    // and saw the zero-length terminator (it only answers after it).
    expect(clamd.sessions[0].payload.equals(fs.readFileSync(file))).toBe(true);
    expect(clamd.sessions[0].reply).toBe("stream: OK");
  });

  it("a file larger than one chunk is split into frames of at most INSTREAM_CHUNK_SIZE", async () => {
    const svc = load();
    const content = crypto.randomBytes(svc.INSTREAM_CHUNK_SIZE * 2 + 123);
    const file = write("big.bin", content);

    const result = await svc.scanFile(file, false);

    expect(result.isClean).toBe(true);
    const { chunkSizes, payload } = clamd.sessions[0];
    expect(chunkSizes.length).toBeGreaterThanOrEqual(3);
    for (const size of chunkSizes) {
      expect(size).toBeLessThanOrEqual(svc.INSTREAM_CHUNK_SIZE);
    }
    expect(payload.equals(content)).toBe(true);
  });

  it("the EICAR test file reads FOUND, with its signature", async () => {
    const svc = load();
    const file = write("eicar.com", EICAR);

    const result = await svc.scanFile(file, false);

    expect(result).toEqual({
      isClean: false,
      code: "FOUND",
      result: "stream: Eicar-Test-Signature FOUND",
      signature: "Eicar-Test-Signature",
    });
    const { logger } = require("../../middlewares/activityLog.middleware");
    expect(logger.warn).toHaveBeenCalledWith(
      "Virus detected in uploaded file",
      expect.objectContaining({ filePath: file }),
    );
  });

  it("an empty file is framed as the terminator alone and reads clean", async () => {
    const svc = load();
    const file = write("empty.txt", "");

    await expect(svc.scanFile(file, false)).resolves.toMatchObject({ isClean: true });
    expect(clamd.sessions[0].chunkSizes).toEqual([]);
  });

  it("a reply split across TCP segments is read up to its NUL, not from the first packet", async () => {
    clamd.setMode({ reply: "stream: Eicar-Test-Signature FOUND", split: true });
    const svc = load();
    const file = write("x.txt", "hello");

    const result = await svc.scanFile(file, false);

    expect(result.code).toBe("FOUND");
    expect(result.signature).toBe("Eicar-Test-Signature");
  });

  it("UNKNOWN COMMAND is NOT clean — the scan fails with 500", async () => {
    clamd.setMode({ reply: "UNKNOWN COMMAND" });
    const svc = load();
    const file = write("clean.txt", "hello");

    const err = await svc.scanFile(file, false).catch((e) => e);

    expect(err).toMatchObject({
      status: 500,
      message: "File scan service unavailable. Please try again later.",
    });
    expect(err.cause.code).toBe("CLAMAV_NO_VERDICT");
    expect(err.cause.message).toContain("UNKNOWN COMMAND");
  });

  it("'INSTREAM size limit exceeded. ERROR' is NOT clean", async () => {
    const svc = load();
    const file = write("huge.bin", crypto.randomBytes(512 * 1024));

    const err = await svc.scanFile(file, false).catch((e) => e);

    expect(err).toMatchObject({ status: 500 });
  });

  it("a connection closed with no reply is NOT clean", async () => {
    clamd.setMode("close");
    const svc = load();
    const file = write("clean.txt", "hello");

    await expect(svc.scanFile(file, false)).rejects.toMatchObject({ status: 500 });
  });

  it("a clamd that never answers times out and is NOT clean", async () => {
    clamd.setMode("hang");
    const svc = load({ CLAMAV_TIMEOUT: "150" });
    const file = write("clean.txt", "hello");

    const err = await svc.scanFile(file, false).catch((e) => e);

    expect(err).toMatchObject({ status: 500 });
    expect(err.cause.message).toBe("ClamAV INSTREAM timed out after 150ms");
  });

  it("a stopped scanner (connection refused) is NOT clean", async () => {
    const closed = await startFakeClamd();
    const port = closed.port;
    await closed.close();
    const svc = load({ CLAMAV_PORT: String(port) });
    const file = write("clean.txt", "hello");

    const err = await svc.scanFile(file, false).catch((e) => e);

    expect(err).toMatchObject({ status: 500 });
    expect(err.cause.code).toBe("ECONNREFUSED");
  });

  it("CLAMAV_DISABLE_ON_ERROR=true is the only way a non-verdict is let through, and it says so", async () => {
    clamd.setMode({ reply: "UNKNOWN COMMAND" });
    const svc = load({ CLAMAV_DISABLE_ON_ERROR: "true" });
    const file = write("clean.txt", "hello");

    const result = await svc.scanFile(file);

    expect(result.code).toBe("ALLOWED");
    expect(result.result).toContain("UNKNOWN COMMAND");
    // An allowed error is never cached as a verdict.
    expect(svc.getCacheStats().size).toBe(0);
  });

  it("connects over a Unix socket / named pipe when CLAMAV_SOCKET_PATH is set", async () => {
    const pipe =
      process.platform === "win32"
        ? `\\\\.\\pipe\\fake-clamd-${process.pid}-${Date.now()}`
        : path.join(tmp, "clamd.sock");
    const local = await startFakeClamd({ path: pipe });
    try {
      const svc = load({ CLAMAV_SOCKET_PATH: pipe, CLAMAV_PORT: "1" });
      const file = write("eicar.com", EICAR);

      const result = await svc.scanFile(file, false);

      expect(result.code).toBe("FOUND");
      expect(local.sessions).toHaveLength(1);
    } finally {
      await local.close();
    }
  });

  it("ping() is true only for PONG", async () => {
    const svc = load();
    await expect(svc.ping()).resolves.toBe(true);
    expect(clamd.sessions[0].command).toBe("zPING");

    clamd.setMode({ reply: "UNKNOWN COMMAND" });
    await expect(svc.ping()).resolves.toBe(false);
  });
});

describe("S-04 — parseClamdReply", () => {
  let svc;
  beforeEach(() => {
    svc = load();
  });

  it.each([
    ["stream: OK\0", true],
    ["stream: OK\n", true],
    ["OK", true],
  ])("%j is clean", (reply, clean) => {
    expect(svc.parseClamdReply(reply).isClean).toBe(clean);
  });

  it("'stream: <sig> FOUND' is infected, with the signature", () => {
    expect(svc.parseClamdReply("stream: Win.Test.EICAR_HDB-1 FOUND\0")).toEqual({
      isClean: false,
      code: "FOUND",
      result: "stream: Win.Test.EICAR_HDB-1 FOUND",
      signature: "Win.Test.EICAR_HDB-1",
    });
  });

  it.each([
    "UNKNOWN COMMAND",
    "INSTREAM size limit exceeded. ERROR",
    "stream: Can't allocate memory ERROR",
    "stream: O",
    "stream: OK but not really",
    "",
    null,
    undefined,
  ])("%j is not a verdict and throws", (reply) => {
    expect(() => svc.parseClamdReply(reply)).toThrow(
      expect.objectContaining({ code: "CLAMAV_NO_VERDICT" }),
    );
  });

  it("names an empty reply as such", () => {
    expect(() => svc.parseClamdReply("")).toThrow("ClamAV returned no verdict: an empty reply");
  });
});

describe("S-04 — frameChunk and writeAsync", () => {
  it("frameChunk prefixes a 4-byte big-endian length", () => {
    const svc = load();
    const framed = svc.frameChunk(Buffer.from("abc"));
    expect([...framed]).toEqual([0, 0, 0, 3, 0x61, 0x62, 0x63]);
    const big = svc.frameChunk(Buffer.alloc(0x010203));
    expect([...big.subarray(0, 4)]).toEqual([0x00, 0x01, 0x02, 0x03]);
  });

  class FakeSocket extends EventEmitter {
    constructor(writeReturns) {
      super();
      this.destroyed = false;
      this.write = jest.fn(() => writeReturns);
    }
  }

  it("resolves at once when the write is accepted", async () => {
    const svc = load();
    await expect(svc.writeAsync(new FakeSocket(true), Buffer.from("x"))).resolves.toBeUndefined();
  });

  it("waits for drain when the buffer is full", async () => {
    const svc = load();
    const s = new FakeSocket(false);
    const p = svc.writeAsync(s, Buffer.from("x"));
    s.emit("drain");
    await expect(p).resolves.toBeUndefined();
    expect(s.listenerCount("close")).toBe(0);
  });

  it("rejects when the connection closes while waiting for drain", async () => {
    const svc = load();
    const s = new FakeSocket(false);
    const p = svc.writeAsync(s, Buffer.from("x"));
    s.emit("close");
    await expect(p).rejects.toThrow("ClamAV connection closed while sending");
    expect(s.listenerCount("drain")).toBe(0);
  });

  it("rejects without writing to a destroyed socket", async () => {
    const svc = load();
    const s = new FakeSocket(true);
    s.destroyed = true;
    await expect(svc.writeAsync(s, Buffer.from("x"))).rejects.toThrow(
      "ClamAV connection closed while sending",
    );
    expect(s.write).not.toHaveBeenCalled();
  });
});

describe("S-17 — the verdict cache is keyed by a content hash", () => {
  it("two different files of the same size and mtime do NOT share a verdict", async () => {
    const { post } = require("axios");
    post
      .mockResolvedValueOnce({ data: "stream: OK" })
      .mockResolvedValueOnce({ data: "stream: Eicar-Test-Signature FOUND" });
    const svc = load({ CLAMAV_HTTP_MODE: "true", CLAMAV_HTTP_URL: "http://clamav.local:9000" });
    svc.clearCache();

    const clean = write("a.txt", "A".repeat(EICAR.length));
    const bad = write("b.txt", EICAR);
    const when = new Date("2026-01-01T00:00:00Z");
    fs.utimesSync(clean, when, when);
    fs.utimesSync(bad, when, when);

    expect((await svc.scanFile(clean)).isClean).toBe(true);
    const second = await svc.scanFile(bad);

    expect(second.isClean).toBe(false);
    expect(second.code).toBe("FOUND");
    expect(post).toHaveBeenCalledTimes(2);
  });

  it("the same content under another name IS a cache hit, keyed by its sha256", async () => {
    const svc = load();
    svc.clearCache();
    const a = write("a.txt", "same bytes");
    const b = write("b.txt", "same bytes");

    expect((await svc.scanFile(a)).code).toBe("OK");
    const hit = await svc.scanFile(b);

    expect(hit).toEqual({ isClean: true, result: "Cache hit", code: "CACHE" });
    expect(clamd.sessions).toHaveLength(1);
    const sha = crypto.createHash("sha256").update("same bytes").digest("hex");
    expect(svc.scanCache.get(sha)).toBe(true);
    await expect(svc.hashFile(a)).resolves.toBe(sha);
  });

  it("a FOUND verdict is cached as not-clean", async () => {
    const svc = load();
    svc.clearCache();
    const a = write("eicar.com", EICAR);
    await svc.scanFile(a);
    expect(await svc.scanFile(a)).toEqual({ isClean: false, result: "Cache hit", code: "CACHE" });
  });

  it("an error is never cached", async () => {
    clamd.setMode({ reply: "UNKNOWN COMMAND" });
    const svc = load();
    svc.clearCache();
    await expect(svc.scanFile(write("a.txt", "x"))).rejects.toMatchObject({ status: 500 });
    expect(svc.getCacheStats().size).toBe(0);
  });

  it("an unreadable file is a scan error, not clean", async () => {
    const svc = load();
    await expect(svc.scanFile(path.join(tmp, "missing.bin"))).rejects.toMatchObject({
      status: 500,
    });
  });

  it("useCache=false neither reads nor writes the cache", async () => {
    const svc = load();
    svc.clearCache();
    const a = write("a.txt", "x");
    await svc.scanFile(a, false);
    await svc.scanFile(a, false);
    expect(clamd.sessions).toHaveLength(2);
    expect(svc.getCacheStats().size).toBe(0);
  });

  it("expires an entry after its TTL, and evicts the oldest at capacity", () => {
    const svc = load();
    const { scanCache } = svc;
    scanCache.clear();
    const realNow = Date.now;
    try {
      const t0 = realNow.call(Date);
      Date.now = jest.fn(() => t0);
      scanCache.set("h1", true);
      expect(scanCache.get("h1")).toBe(true);
      Date.now = jest.fn(() => t0 + scanCache._ttl + 1);
      expect(scanCache.get("h1")).toBeNull();
      expect(scanCache.size()).toBe(0);
    } finally {
      Date.now = realNow;
    }

    scanCache._maxSize = 2;
    scanCache.set("k1", true);
    scanCache.set("k2", false);
    scanCache.set("k3", true);
    expect(scanCache.get("k1")).toBeNull();
    expect(scanCache.get("k2")).toBe(false);
    expect(scanCache.get("k3")).toBe(true);
  });
});

describe("HTTP mode — the body is parsed like a clamd reply (S-04)", () => {
  const http = { CLAMAV_HTTP_MODE: "true", CLAMAV_HTTP_URL: "http://clamav.local:9000" };

  it("OK is clean, and the key header is sent when configured", async () => {
    const { post } = require("axios");
    post.mockResolvedValueOnce({ data: "stream: OK\n" });
    const svc = load({ ...http, CLAMAV_HTTP_KEY: "k" });

    const result = await svc.scanFile(write("a.txt", "x"), false);

    expect(result.isClean).toBe(true);
    expect(post.mock.calls[0][2].headers).toEqual({
      "Content-Type": "application/octet-stream",
      "X-HTTP-Key": "k",
    });
  });

  it("omits the key header when none is configured", async () => {
    const { post } = require("axios");
    post.mockResolvedValueOnce({ data: "OK" });
    const svc = load({ ...http, CLAMAV_HTTP_KEY: undefined });

    await svc.scanFile(write("a.txt", "x"), false);

    expect(post.mock.calls[0][2].headers).toEqual({
      "Content-Type": "application/octet-stream",
    });
  });

  it("a body that is not a verdict ('UNKNOWN COMMAND') is NOT clean", async () => {
    const { post } = require("axios");
    post.mockResolvedValueOnce({ data: "UNKNOWN COMMAND" });
    const svc = load(http);

    await expect(svc.scanFile(write("a.txt", "x"), false)).rejects.toMatchObject({
      status: 500,
    });
  });

  it("an HTTP error status and a transport error both fail the scan", async () => {
    const { post } = require("axios");
    const withStatus = new Error("Request failed");
    withStatus.response = { status: 502 };
    post.mockRejectedValueOnce(withStatus).mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const svc = load({ ...http, CLAMAV_DISABLE_ON_ERROR: "true" });

    expect((await svc.scanFile(write("a.txt", "x"), false)).result).toBe(
      "Allowed (scan error: ClamAV HTTP error: 502)",
    );
    expect((await svc.scanFile(write("b.txt", "y"), false)).result).toBe(
      "Allowed (scan error: ClamAV HTTP scan failed)",
    );
  });

  it("HTTP mode with no URL falls back to the socket", async () => {
    const { post } = require("axios");
    const svc = load({ CLAMAV_HTTP_MODE: "true", CLAMAV_HTTP_URL: undefined });

    await expect(svc.scanFile(write("a.txt", "x"), false)).resolves.toMatchObject({
      code: "OK",
    });
    expect(post).not.toHaveBeenCalled();
    expect(clamd.sessions).toHaveLength(1);
  });
});

describe("configuration surface", () => {
  it("skips (code SKIPPED) when CLAMAV_ENABLED is not 'true'", async () => {
    const svc = load({ CLAMAV_ENABLED: "false" });
    await expect(svc.scanFile("/whatever")).resolves.toEqual({
      isClean: true,
      result: "Skipped (disabled)",
      code: "SKIPPED",
    });
    expect(svc.isConfigured()).toBe(false);
    expect(svc.getStatus()).toMatchObject({ enabled: false, mode: "socket" });
  });

  it("refuses an empty path with 400", async () => {
    const svc = load();
    await expect(svc.scanFile("")).rejects.toMatchObject({ status: 400 });
    await expect(svc.scanFile(null)).rejects.toMatchObject({ status: 400 });
  });

  it("isConfigured / getStatus report the configured mode", () => {
    let svc = load({ CLAMAV_HTTP_MODE: "true", CLAMAV_HTTP_URL: "http://c:8080" });
    expect(svc.isConfigured()).toBe(true);
    expect(svc.getStatus()).toMatchObject({ enabled: true, mode: "http", host: "http://c:8080" });

    jest.resetModules();
    svc = load({ CLAMAV_SOCKET_PATH: "/var/run/clamav/clamd.ctl" });
    expect(svc.isConfigured()).toBeTruthy();
    expect(svc.getStatus().host).toBe(`127.0.0.1:${clamd.port}`);
  });

  it("the default port and timeout apply when unset", () => {
    const svc = load({ CLAMAV_PORT: undefined, CLAMAV_TIMEOUT: undefined, CLAMAV_HOST: undefined });
    expect(svc.getStatus().host).toBe("127.0.0.1:3310");
  });

  it("scanFiles reports each file, and a scan error as not clean", async () => {
    clamd.setMode({ reply: "UNKNOWN COMMAND" });
    const svc = load();
    const results = await svc.scanFiles([{ path: write("a.txt", "x") }]);
    expect(results[0].isClean).toBe(false);
    expect(results[0].result).toContain("Scan error: File scan service unavailable");

    const off = (jest.resetModules(), load({ CLAMAV_ENABLED: "false" }));
    const skipped = await off.scanFiles([{ path: "/a" }, { path: "/b" }]);
    expect(skipped.map((r) => r.isClean)).toEqual([true, true]);
  });

  it("clearCache and getCacheStats", () => {
    const svc = load();
    svc.scanCache.set("x", true);
    svc.clearCache();
    expect(svc.getCacheStats()).toEqual({ size: 0, maxSize: 10000, ttl: 24 * 60 * 60 * 1000 });
  });

  it("exposes scanCache only under NODE_ENV=test", () => {
    const svc = load({ NODE_ENV: "production" });
    expect(svc.scanCache).toBeUndefined();
  });
});

const LIVE_PORT = process.env.CLAMAV_LIVE_PORT;
(LIVE_PORT ? describe : describe.skip)(
  "S-04 — against a REAL clamd (CLAMAV_LIVE_PORT)",
  () => {
    const live = () =>
      load({ CLAMAV_PORT: LIVE_PORT, CLAMAV_HOST: process.env.CLAMAV_LIVE_HOST || "127.0.0.1", CLAMAV_TIMEOUT: "30000" });

    it("answers PING", async () => {
      await expect(live().ping()).resolves.toBe(true);
    });

    it("a clean multi-chunk file reads 'stream: OK'", async () => {
      const result = await live().scanFile(write("big.bin", crypto.randomBytes(300 * 1024)), false);
      expect(result).toEqual({ isClean: true, code: "OK", result: "stream: OK" });
    });

    it("the EICAR test file reads FOUND", async () => {
      const result = await live().scanFile(write("eicar.com", EICAR), false);
      expect(result.isClean).toBe(false);
      expect(result.code).toBe("FOUND");
      expect(result.result).toMatch(/^stream: .*Eicar.* FOUND$/i);
    });
  },
);
