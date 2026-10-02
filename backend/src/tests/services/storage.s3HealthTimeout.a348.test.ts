/**
 * A-348 (2026-10-02) — the S3 connection test is bounded.
 *
 * `PUT /storage/settings` saves only after `healthCheck()` succeeds, and
 * answers 422 when it fails. The SDK's default HTTP handler has no connect or
 * request timeout and retries, so a test against an endpoint that accepts the
 * connection and never answers waited past every client's timeout (the live
 * run J's `TimeoutError` at 15 s). Fail-before: without the abort signal the
 * "never answers" case below was still pending when its 10 s jest timeout
 * expired.
 *
 * REAL `@aws-sdk/client-s3` and its Node HTTP handler, against sockets on
 * 127.0.0.1 opened by this test (`endpointTrusted`: the operator-endpoint
 * path, so the SSRF guard does not refuse the loopback address first).
 */
import net from "net";
import type { AddressInfo } from "net";
import S3Driver from "../../services/storage/s3.driver";

const sockets = new Set<net.Socket>();
let silent: net.Server;
let silentPort = 0;
let closedPort = 0;

const listen = (server: net.Server): Promise<number> =>
  new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve((server.address() as AddressInfo).port);
    });
  });

const driverAt = (port: number, healthCheckTimeoutMs?: number): S3Driver =>
  new S3Driver({
    bucket: "a348-bucket",
    region: "us-east-1",
    endpoint: `http://127.0.0.1:${String(port)}`,
    endpointTrusted: true,
    accessKeyId: "AKIAA348TEST",
    secretAccessKey: "a348-secret",
    ...(healthCheckTimeoutMs === undefined ? {} : { healthCheckTimeoutMs }),
  });

beforeAll(async () => {
  // Accepts every connection and never writes a byte: a black-holed endpoint.
  silent = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("error", () => undefined);
  });
  silentPort = await listen(silent);

  // A port that was free a moment ago and is closed now: connection refused.
  const probe = net.createServer();
  closedPort = await listen(probe);
  await new Promise<void>((resolve) => {
    probe.close(() => {
      resolve();
    });
  });

  // The SDK loads its handler, signer and retry modules on the first send;
  // under jest that alone can outlast a short bound. One refused call first,
  // so the bound below times the connection, not the module loading.
  await driverAt(closedPort, 10_000).healthCheck();
}, 20_000);

afterAll(async () => {
  for (const socket of sockets) {
    socket.destroy();
  }
  await new Promise<void>((resolve) => {
    silent.close(() => {
      resolve();
    });
  });
});

describe("A-348 — S3Driver.healthCheck() answers within its bound", () => {
  it("an endpoint that never answers is a failed test after the bound, not a hang", async () => {
    const started = Date.now();
    const health = await driverAt(silentPort, 300).healthCheck();
    const elapsed = Date.now() - started;
    expect(health).toEqual({ ok: false, driver: "s3", bucket: "a348-bucket", error: "no answer within 300 ms" });
    expect(elapsed).toBeGreaterThanOrEqual(250);
    expect(elapsed).toBeLessThan(3000);
    expect(sockets.size).toBeGreaterThan(0);
  }, 10_000);

  it("a refused connection fails fast with the SDK's own message", async () => {
    const started = Date.now();
    const health = await driverAt(closedPort).healthCheck();
    expect(health.ok).toBe(false);
    expect(health.error).not.toMatch(/^no answer within/);
    expect(Date.now() - started).toBeLessThan(5000);
  }, 10_000);

  it("the default bound is 5000 ms", () => {
    expect(driverAt(silentPort).healthCheckTimeoutMs).toBe(5000);
  });
});
