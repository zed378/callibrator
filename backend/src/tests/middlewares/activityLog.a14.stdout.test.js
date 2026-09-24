/**
 * A-14 — production logging, proven on the process's REAL stdout.
 *
 * Each case starts a separate Node process with NODE_ENV=production that loads
 * the real activityLog.middleware (real winston, real Console transport), mounts
 * the real `activityLogger` on a real Express app, serves one real HTTP request,
 * and exits. The parent reads what the child wrote to stdout — the stream
 * Docker collects. Nothing here is mocked except the storage root, which is
 * pointed at a temporary directory so the test can see whether files appear.
 *
 * Before A-14 the first case fails: production had no Console transport, so
 * stdout was empty; the per-request line was `http`, below the `info` level.
 */
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const BACKEND = path.resolve(__dirname, "../../..");

// Independently written list of things that must never reach a log line.
// Deliberately NOT derived from the redactor's own key set.
const SECRETS = {
  password: "Hunter2-Plaintext!",
  totp: "492817",
  bearer: "sk_live_abcdef0123456789",
  jwt: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEifQ.c2lnbmF0dXJlLXZhbHVl",
  cookie: "connect.sid=s%3AsessionCookieValue",
  queryToken: "resetTok3nValue",
  refresh: "refresh-token-value-xyz",
};

const childScript = (storageRoot) => `
const path = require("path");
const Module = require("module");
const BACKEND = ${JSON.stringify(BACKEND)};
const storageMod = require.resolve(path.join(BACKEND, "src/utils/storagePath.util"));
const m = new Module(storageMod);
m.filename = storageMod;
m.loaded = true;
m.exports = (...parts) => path.join(${JSON.stringify(storageRoot)}, ...parts);
require.cache[storageMod] = m;

const express = require("express");
const http = require("http");
const { activityLogger, logger } = require(path.join(BACKEND, "src/middlewares/activityLog.middleware"));
const S = ${JSON.stringify(SECRETS)};

if (process.argv[1] === "crash") {
  setImmediate(() => { throw new Error("boot failure, Authorization: Bearer " + S.bearer); });
} else {
const app = express();
app.use(express.json());
app.use((req, res, next) => { req.requestId = "req-a14-0001"; res.setHeader("X-Request-Id", req.requestId); next(); });
app.use(activityLogger);
app.post("/api/v1/auth/login", (req, res) => {
  logger.info("login attempt", {
    body: req.body,
    headers: req.headers,
    nested: { deeper: { apiKey: S.bearer } },
    note: "forwarded Bearer " + S.bearer,
  });
  res.status(201).json({ ok: true });
});

const server = app.listen(0, "127.0.0.1", () => {
  const body = JSON.stringify({ email: "a@b.c", password: S.password, otp: S.totp, refreshToken: S.refresh });
  const req = http.request({
    host: "127.0.0.1",
    port: server.address().port,
    method: "POST",
    path: "/api/v1/auth/login?token=" + S.queryToken + "&page=2",
    headers: {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(body),
      authorization: "Bearer " + S.jwt,
      cookie: S.cookie,
    },
  }, (res) => {
    res.resume();
    res.on("end", () => server.close(() => setTimeout(() => process.exit(0), 50)));
  });
  req.end(body);
});
}
`;

const runChild = (env, arg) => {
  const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "a14-log-"));
  const childEnv = { ...process.env, NODE_ENV: "production", ...env };
  delete childEnv.LOG_LEVEL;
  if (!("LOG_TO_FILE" in env)) {delete childEnv.LOG_TO_FILE;}
  const args = ["-e", childScript(storageRoot)];
  if (arg) {args.push(arg);}
  const result = spawnSync(process.execPath, args, {
    cwd: BACKEND,
    env: childEnv,
    encoding: "utf8",
    timeout: 20000,
  });
  const lines = result.stdout.split("\n").filter((l) => l.trim() !== "");
  return { ...result, lines, storageRoot };
};

const listFiles = (dir) => {
  if (!fs.existsSync(dir)) {return [];}
  return fs.readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => path.join(d.parentPath || d.path, d.name));
};

describe("A-14: the real logger in production writes JSON lines to stdout", () => {
  let run;

  beforeAll(() => {
    run = runChild({});
  }, 30000);

  afterAll(() => {
    fs.rmSync(run.storageRoot, { recursive: true, force: true });
  });

  it("A-14: stdout is not empty in production, and every line is a JSON object", () => {
    expect(run.status).toBe(0);
    expect(run.lines.length).toBeGreaterThanOrEqual(2);
    for (const line of run.lines) {
      const parsed = JSON.parse(line);
      expect(typeof parsed).toBe("object");
      expect(typeof parsed.level).toBe("string");
      expect(typeof parsed.timestamp).toBe("string");
    }
  });

  it("A-14: the per-request completion line is emitted at info with request id, status and a NUMERIC duration", () => {
    const records = run.lines.map((l) => JSON.parse(l));
    const response = records.find((r) => r.type === "RESPONSE");
    expect(response).toBeDefined();
    expect(response.level).toBe("info");
    expect(response.requestId).toBe("req-a14-0001");
    expect(response.statusCode).toBe(201);
    expect(response.method).toBe("POST");
    expect(typeof response.durationMs).toBe("number");
    expect(response.durationMs).toBeGreaterThanOrEqual(0);
    // the arrival line stays at `http` and is below the production level
    expect(records.find((r) => r.type === "REQUEST")).toBeUndefined();
  });

  it("A-14: the logged URL keeps its path and harmless parameters but redacts ?token=", () => {
    const response = run.lines.map((l) => JSON.parse(l)).find((r) => r.type === "RESPONSE");
    expect(response.url).toBe("/api/v1/auth/login?token=[REDACTED]&page=2");
  });

  it("A-14: no password, TOTP code, bearer token, JWT, cookie or refresh token reaches stdout", () => {
    for (const [name, secret] of Object.entries(SECRETS)) {
      expect({ name, leaked: run.stdout.includes(secret) }).toEqual({ name, leaked: false });
    }
    const login = run.lines.map((l) => JSON.parse(l)).find((r) => r.message === "login attempt");
    expect(login.body.email).toBe("a@b.c");
    expect(login.body.password).toBe("[REDACTED]");
    expect(login.body.otp).toBe("[REDACTED]");
    expect(login.body.refreshToken).toBe("[REDACTED]");
    expect(login.headers.authorization).toBe("[REDACTED]");
    expect(login.headers.cookie).toBe("[REDACTED]");
    expect(login.headers["content-type"]).toBe("application/json");
    expect(login.nested.deeper.apiKey).toBe("[REDACTED]");
    expect(login.note).toBe("forwarded Bearer [REDACTED]");
  });

  it("A-14: production writes no log files unless LOG_TO_FILE=true", () => {
    expect(listFiles(run.storageRoot)).toEqual([]);
  });
});

describe("A-14: optional, bounded file logging in production", () => {
  it("A-14: LOG_TO_FILE=true writes the rotated combined file as well as stdout", () => {
    const run = runChild({ LOG_TO_FILE: "true" });
    try {
      expect(run.status).toBe(0);
      expect(run.lines.length).toBeGreaterThanOrEqual(2);
      const combined = listFiles(path.join(run.storageRoot, "log/activity/combined"))
        .filter((f) => f.endsWith(".log"));
      expect(combined.length).toBe(1);
      const content = fs.readFileSync(combined[0], "utf8");
      expect(content).toContain('"type":"RESPONSE"');
      for (const secret of Object.values(SECRETS)) {
        expect(content.includes(secret)).toBe(false);
      }
    } finally {
      fs.rmSync(run.storageRoot, { recursive: true, force: true });
    }
  }, 30000);
});

describe("A-14: a crash is visible on stdout", () => {
  it("A-14: an uncaught exception is written to stdout as JSON, redacted, and the process exits non-zero", () => {
    const run = runChild({}, "crash");
    try {
      expect(run.status).not.toBe(0);
      const records = run.lines.map((l) => JSON.parse(l));
      const crash = records.find((r) => String(r.message).includes("uncaughtException"));
      expect(crash).toBeDefined();
      expect(crash.level).toBe("error");
      expect(run.stdout).toContain("boot failure");
      expect(run.stdout.includes(SECRETS.bearer)).toBe(false);
    } finally {
      fs.rmSync(run.storageRoot, { recursive: true, force: true });
    }
  }, 30000);
});
