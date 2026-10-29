/* eslint-disable no-restricted-properties -- tests exercise process.env directly */
/**
 * activityLog.middleware — in-process unit tests (A-14).
 *
 * The real winston is used throughout; only the storage root is redirected to
 * a temporary directory. What reaches the process's actual stdout in
 * production is proven separately, in a child process, by
 * activityLog.a14.stdout.test.js.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { Writable } from "stream";
import type { Request, Response } from "express";
import type { Logger } from "winston";
import type * as WinstonModule from "winston";
import type { TransformableInfo } from "logform";
import type * as ActivityLogMiddleware from "../../middlewares/activityLog.middleware";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "a14-unit-"));
jest.mock("../../utils/storagePath.util", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const p = require("path") as typeof path;
  return (...parts: string[]) => p.join(process.env["__A14_TMP"] ?? "", ...parts);
});
process.env["__A14_TMP"] = TMP;

const ENV_KEYS = ["NODE_ENV", "LOG_TO_FILE", "LOG_LEVEL"] as const;
const saved: Record<string, string | undefined> = {};

type ActivityLogModule = typeof ActivityLogMiddleware;

const load = (env: Record<string, string | undefined>): ActivityLogModule => {
  for (const k of ENV_KEYS) {
    if (env[k] === undefined) {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete process.env[k];
    } else {
      process.env[k] = env[k];
    }
  }
  let mod!: ActivityLogModule;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    mod = require("../../middlewares/activityLog.middleware") as ActivityLogModule;
  });
  return mod;
};

interface CaptureResult {
  records: Record<string, unknown>[];
  done: () => void;
}

/** Adds a Stream transport to the real logger and returns the parsed records. */
const capture = (loggerToCapture: Logger): CaptureResult => {
  const records: Record<string, unknown>[] = [];
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { transports } = require("winston") as typeof WinstonModule;
  const stream = new Writable({
    write(chunk: Buffer, _enc: BufferEncoding, cb: () => void) {
      records.push(JSON.parse(chunk.toString()) as Record<string, unknown>);
      cb();
    },
  });
  const t = new transports.Stream({ stream });
  loggerToCapture.add(t);
  return {
    records,
    done: () => {
      loggerToCapture.remove(t);
    },
  };
};

const loggers: Logger[] = [];
const track = (mod: ActivityLogModule): ActivityLogModule => {
  loggers.push(mod.logger);
  return mod;
};

beforeAll(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
  }
});

afterAll(async () => {
  for (const l of loggers) {
    l.exceptions.unhandle();
    l.rejections.unhandle();
    l.close();
  }
  // let the rotating-file transports finish closing before their directory goes
  await new Promise((resolve) => setTimeout(resolve, 300));
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete process.env[k];
    } else {
      process.env[k] = saved[k];
    }
  }
  fs.rmSync(TMP, { recursive: true, force: true });
});

interface DailyRotateFileTransport {
  name?: string;
  level?: string;
  options: {
    maxFiles?: string;
    maxSize?: string;
    zippedArchive?: boolean;
  };
  constructor: { name: string };
}

const fileTransports = (loggerInstance: Logger): DailyRotateFileTransport[] =>
  loggerInstance.transports.filter(
    (t) => t.constructor.name === "DailyRotateFile",
  ) as unknown as DailyRotateFileTransport[];

describe("activityLog.middleware — configuration (A-14)", () => {
  it("A-14: production has a Console transport, level info, and no file transports by default", () => {
    const { logger } = track(load({ NODE_ENV: "production" }));
    const consoles = logger.transports.filter((t) => (t as { name?: string }).name === "console") as {
      handleExceptions: boolean;
      handleRejections: boolean;
      format?: unknown;
    }[];
    expect(consoles).toHaveLength(1);
    expect(consoles[0]?.handleExceptions).toBe(true);
    expect(consoles[0]?.handleRejections).toBe(true);
    // production console uses the logger's JSON format, not the dev printf
    expect(consoles[0]?.format).toBeUndefined();
    expect(logger.level).toBe("info");
    expect(fileTransports(logger)).toHaveLength(0);
  });

  it("A-14: production with LOG_TO_FILE=true adds bounded, rotated files, including the exception and rejection handlers", () => {
    const { logger } = track(load({ NODE_ENV: "production", LOG_TO_FILE: "true" }));
    const files = fileTransports(logger);
    expect(files).toHaveLength(2);
    const handlers = [
      ...logger.exceptions.handlers.keys(),
      ...logger.rejections.handlers.keys(),
    ].filter(
      (t: unknown) => (t as { constructor: { name: string } }).constructor.name === "DailyRotateFile",
    ) as DailyRotateFileTransport[];
    expect(handlers).toHaveLength(2);
    for (const t of [...files, ...handlers]) {
      expect(t.options.maxFiles).toBe("30d");
      expect(t.options.maxSize).toBe("20m");
      expect(t.options.zippedArchive).toBe(true);
    }
    expect(files.map((t) => t.level)).toEqual(["error", undefined]);
  });

  it("A-14: development writes files by default; LOG_TO_FILE=false and LOG_TO_FILE='' are honoured", () => {
    const dev = track(load({ NODE_ENV: "development" }));
    expect(dev.logger.level).toBe("debug");
    expect(fileTransports(dev.logger)).toHaveLength(2);

    const off = track(load({ NODE_ENV: "development", LOG_TO_FILE: "false" }));
    expect(fileTransports(off.logger)).toHaveLength(0);

    const empty = track(load({ NODE_ENV: "development", LOG_TO_FILE: "" }));
    expect(fileTransports(empty.logger)).toHaveLength(2);
  });

  it("A-14: LOG_LEVEL overrides the default level", () => {
    const { logger } = track(load({ NODE_ENV: "production", LOG_LEVEL: "warn" }));
    expect(logger.level).toBe("warn");
  });

  it("the development console prints a readable line through printf", () => {
    const { logger } = track(load({ NODE_ENV: "development", LOG_TO_FILE: "false" }));
    const consoleT = logger.transports.find((t) => (t as { name?: string }).name === "console") as {
      format: { transform: (info: unknown) => Record<string | symbol, unknown> };
    };
    const out = consoleT.format.transform({
      level: "info",
      message: "hello",
      timestamp: "2026-09-24T00:00:00.000Z",
      [Symbol.for("level")]: "info",
    });
    expect(out[Symbol.for("message")]).toContain("2026-09-24T00:00:00.000Z");
    expect(out[Symbol.for("message")]).toContain("hello");
  });
});

describe("activityLog.middleware — redaction (A-14)", () => {
  let mod: ActivityLogModule;
  beforeAll(() => {
    mod = track(load({ NODE_ENV: "production" }));
  });

  const redact = (info: Record<string | symbol, unknown>) =>
    mod.redactFormat().transform(info as TransformableInfo) as Record<string | symbol, unknown>;

  it("A-14: redacts credential keys at any depth, in any casing or separator style", () => {
    const out = redact({
      level: "info",
      message: "m",
      password: "p1",
      user: { Password: "p2", profile: { mfa_secret: "s", name: "keep" } },
      headers: {
        Authorization: "Bearer abc",
        cookie: "a=b",
        "set-cookie": ["x"],
        "x-api-key": "k",
        "user-agent": "curl",
      },
      creds: { accessToken: "t", refresh_token: "r", privateKey: "pk", credentials: { a: 1 } },
      otp: "123456",
      otpCode: "123456",
      totp: "123456",
      pass: "p",
      sessionId: "sid",
      sid: "sid",
    }) as {
      password: string;
      user: { Password: string; profile: { mfa_secret: string; name: string } };
      headers: Record<string, unknown>;
      creds: Record<string, unknown>;
      [key: string]: unknown;
    };
    expect(out.password).toBe("[REDACTED]");
    expect(out.user.Password).toBe("[REDACTED]");
    expect(out.user.profile.mfa_secret).toBe("[REDACTED]");
    expect(out.user.profile.name).toBe("keep");
    expect(out.headers["Authorization"]).toBe("[REDACTED]");
    expect(out.headers["cookie"]).toBe("[REDACTED]");
    expect(out.headers["set-cookie"]).toBe("[REDACTED]");
    expect(out.headers["x-api-key"]).toBe("[REDACTED]");
    expect(out.headers["user-agent"]).toBe("curl");
    expect(out.creds).toEqual({
      accessToken: "[REDACTED]",
      refresh_token: "[REDACTED]",
      privateKey: "[REDACTED]",
      credentials: "[REDACTED]",
    });
    for (const k of ["otp", "otpCode", "totp", "pass", "sessionId", "sid"]) {
      expect(out[k]).toBe("[REDACTED]");
    }
  });

  it("A-14: redacts a numeric one-time code under a generic key, but keeps an error code", () => {
    const out = redact({
      level: "info",
      message: "m",
      code: "123456",
      pin: 4321,
      err: { code: "ECONNREFUSED" },
      verification_code: " 99887766 ",
    }) as {
      code: string;
      pin: string;
      err: { code: string };
      verification_code: string;
    };
    expect(out.code).toBe("[REDACTED]");
    expect(out.pin).toBe("[REDACTED]");
    expect(out.err.code).toBe("ECONNREFUSED");
    expect(out.verification_code).toBe("[REDACTED]");
  });

  it("A-14: leaves empty, null and undefined values under sensitive keys as they are", () => {
    const out = redact({ level: "info", message: "m", password: "", token: null, secret: undefined, code: null }) as {
      password: string;
      token: unknown;
      secret: unknown;
      code: unknown;
    };
    expect(out.password).toBe("");
    expect(out.token).toBeNull();
    expect(out.secret).toBeUndefined();
    expect(out.code).toBeNull();
  });

  it("A-14: scrubs bearer credentials and JWTs that appear as values under harmless keys and in the message", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl";
    const out = redact({
      level: "info",
      message: `header was Bearer ${jwt}`,
      note: `token ${jwt} leaked`,
      basic: "Basic dXNlcjpwYXNz",
    }) as {
      message: string;
      note: string;
      basic: string;
    };
    expect(out.message).toBe("header was Bearer [REDACTED]");
    expect(out.note).toBe("token [REDACTED] leaked");
    expect(out.basic).toBe("Basic [REDACTED]");
  });

  it("A-14: never mutates the object the caller logged, and keeps winston's Symbol keys", () => {
    const LEVEL = Symbol.for("level");
    const meta = { body: { password: "secret-pw" } };
    const info = { level: "info", message: "m", body: meta.body, [LEVEL]: "info" };
    const out = redact(info) as {
      body: { password: string };
      [key: symbol]: unknown;
    };
    expect(out).not.toBe(info);
    expect(out[LEVEL]).toBe("info");
    expect(out.body.password).toBe("[REDACTED]");
    expect(meta.body.password).toBe("secret-pw");
  });

  it("handles arrays, dates, buffers, errors, toJSON, cycles and depth", () => {
    const date = new Date("2026-01-01T00:00:00Z");
    const cyc: { name: string; self?: unknown } = { name: "c" };
    cyc.self = cyc;
    const err = new Error("boom") as Error & { code?: string; config?: { headers: { Authorization: string } } };
    err.code = "E1";
    err.config = { headers: { Authorization: "Bearer zzz" } };
    const model = { toJSON: () => ({ id: 1, password: "hash" }) };
    const prim = { toJSON: () => "as-string Bearer qqq" };
    const nul = { toJSON: () => null };
    let deep: Record<string, unknown> = { leaf: true };
    for (let i = 0; i < 12; i += 1) {
      deep = { d: deep };
    }

    const out = redact({
      level: "info",
      message: "m",
      list: [{ token: "t" }, "Bearer x", 3],
      date,
      buf: Buffer.from("abc"),
      cyc,
      err,
      model,
      prim,
      nul,
      deep,
      n: 5,
      b: true,
    }) as {
      list: unknown[];
      date: unknown;
      buf: unknown;
      cyc: { self: unknown };
      err: Error & { code?: string; config?: { headers: { Authorization: string } } };
      model: unknown;
      prim: unknown;
      nul: unknown;
      deep: unknown;
      n: unknown;
      b: unknown;
    };
    expect(out.list).toEqual([{ token: "[REDACTED]" }, "Bearer [REDACTED]", 3]);
    expect(out.date).toBe(date);
    expect(out.buf).toBe("[Buffer 3 bytes]");
    expect(out.cyc.self).toBe("[Circular]");
    expect(out.err.message).toBe("boom");
    expect(out.err.name).toBe("Error");
    expect(out.err.code).toBe("E1");
    expect(typeof out.err.stack).toBe("string");
    expect(out.err.config?.headers.Authorization).toBe("[REDACTED]");
    expect(out.model).toEqual({ id: 1, password: "[REDACTED]" });
    expect(out.prim).toBe("as-string Bearer [REDACTED]");
    expect(out.nul).toBeNull();
    expect(JSON.stringify(out.deep)).toContain("[Truncated]");
    expect(out.n).toBe(5);
    expect(out.b).toBe(true);
  });

  it("A-14: the real logger applies the redaction before any transport sees the record", () => {
    const { records, done } = capture(mod.logger);
    mod.logger.info("login", { body: { email: "alice@hospital.example", password: "pw-plain" } });
    done();
    expect(records).toHaveLength(1);
    // A-228: the address is masked as well.
    expect(records[0]?.["body"]).toEqual({ email: "a***@hospital.example", password: "[REDACTED]" });
    expect(typeof records[0]?.["timestamp"]).toBe("string");
  });

  it("isSensitiveKey matches credential names and not ordinary ones", () => {
    expect(mod.isSensitiveKey("Authorization")).toBe(true);
    expect(mod.isSensitiveKey("webauthnPublicKey")).toBe(true);
    expect(mod.isSensitiveKey("iotDeviceToken")).toBe(true);
    expect(mod.isSensitiveKey("email")).toBe(false);
    expect(mod.isSensitiveKey("bypass")).toBe(false);
  });
});

describe("activityLog.middleware — sanitizeUrl (A-14)", () => {
  let sanitizeUrl: (url?: string) => string | undefined;
  beforeAll(() => {
    ({ sanitizeUrl } = track(load({ NODE_ENV: "production" })));
  });

  it("A-14: redacts sensitive query parameters and keeps the rest", () => {
    expect(sanitizeUrl("/reset?token=abc&page=2")).toBe("/reset?token=[REDACTED]&page=2");
    expect(sanitizeUrl("/sso/callback?code=xyz&state=s1")).toBe(
      "/sso/callback?code=[REDACTED]&state=[REDACTED]",
    );
    expect(sanitizeUrl("/x?api_key=k&flag")).toBe("/x?api_key=[REDACTED]&flag");
    expect(sanitizeUrl("/x?%E0%A4%A=1&q=a")).toBe("/x?%E0%A4%A=1&q=a");
    expect(sanitizeUrl("/x?access%5Ftoken=t")).toBe("/x?access%5Ftoken=[REDACTED]");
  });

  it("returns paths without a query (scrubbed) and non-strings unchanged", () => {
    expect(sanitizeUrl("/api/v1/devices")).toBe("/api/v1/devices");
    expect(sanitizeUrl(undefined)).toBeUndefined();
  });
});

describe("activityLog.middleware — activityLogger (A-14)", () => {
  let mod: ActivityLogModule;
  beforeAll(() => {
    mod = track(load({ NODE_ENV: "development", LOG_TO_FILE: "false" }));
  });

  interface MockRes {
    statusCode: number;
    getHeader: jest.Mock;
    setHeader: jest.Mock;
    on: jest.Mock;
    finish: () => void;
    handlers: Record<string, () => void>;
  }

  const makeRes = (header?: string): MockRes => {
    const handlers: Record<string, () => void> = {};
    return {
      statusCode: 200,
      getHeader: jest.fn(() => header),
      setHeader: jest.fn(),
      on: jest.fn((event: string, cb: () => void) => {
        handlers[event] = cb;
      }),
      finish() {
        handlers["finish"]?.();
      },
      handlers,
    };
  };

  interface MockReq {
    ip: string;
    method: string;
    originalUrl: string;
    requestId?: string;
    user?: { id: string; tenantId: string };
    tenantId?: string;
  }

  it("assigns a request id and sets the header when none exists", () => {
    const req: MockReq = { ip: "127.0.0.1", method: "GET", originalUrl: "/api/users" };
    const res = makeRes(undefined);
    const next = jest.fn();
    mod.activityLogger(req as unknown as Request, res as unknown as Response, next);
    expect(req.requestId).toEqual(expect.any(String));
    expect(res.setHeader).toHaveBeenCalledWith("X-Request-Id", req.requestId);
    expect(next).toHaveBeenCalled();
  });

  it("reuses an existing request id and does not overwrite an existing header", () => {
    const req: MockReq = { ip: "127.0.0.1", method: "POST", originalUrl: "/api/data", requestId: "rid-1" };
    const res = makeRes("rid-1");
    mod.activityLogger(req as unknown as Request, res as unknown as Response, jest.fn());
    expect(req.requestId).toBe("rid-1");
    expect(res.setHeader).not.toHaveBeenCalled();
  });

  it("A-14: logs completion at info with request id, status, numeric durationMs, actor and a sanitised url", () => {
    const { records, done } = capture(mod.logger);
    const req: MockReq = {
      ip: "10.0.0.1",
      method: "PUT",
      originalUrl: "/api/reports?token=abc",
      requestId: "rid-2",
    };
    const res = makeRes(undefined);
    mod.activityLogger(req as unknown as Request, res as unknown as Response, jest.fn());
    req.user = { id: "u-1", tenantId: "t-1" };
    res.statusCode = 204;
    res.finish();
    done();
    const request = records.find((r) => r["type"] === "REQUEST");
    const response = records.find((r) => r["type"] === "RESPONSE");
    expect(request?.["level"]).toBe("http");
    expect(request?.["message"]).toBe("request received");
    expect(request?.["url"]).toBe("/api/reports?token=[REDACTED]");
    expect(response).toMatchObject({
      level: "info",
      message: "request completed",
      requestId: "rid-2",
      statusCode: 204,
      method: "PUT",
      url: "/api/reports?token=[REDACTED]",
      userId: "u-1",
      tenantId: "t-1",
      ip: "10.0.0.1",
    });
    expect(typeof response?.["durationMs"]).toBe("number");
  });

  it("prefers req.tenantId and records null actor fields for an anonymous request", () => {
    const { records, done } = capture(mod.logger);
    const req: MockReq = { ip: "1.1.1.1", method: "GET", originalUrl: "/a", requestId: "rid-3", tenantId: "t-9" };
    const res = makeRes(undefined);
    mod.activityLogger(req as unknown as Request, res as unknown as Response, jest.fn());
    res.finish();
    const anon: MockReq = { ip: "1.1.1.1", method: "GET", originalUrl: "/b", requestId: "rid-4" };
    const res2 = makeRes(undefined);
    mod.activityLogger(anon as unknown as Request, res2 as unknown as Response, jest.fn());
    res2.finish();
    done();
    const byId = (id: string) => records.find((r) => r["type"] === "RESPONSE" && r["requestId"] === id);
    expect(byId("rid-3")).toMatchObject({ tenantId: "t-9", userId: null });
    expect(byId("rid-4")).toMatchObject({ tenantId: null, userId: null });
  });

  it.each(["/health", "/live", "/ready", "/docs", "/"])(
    "does not log the excluded path %s",
    (url) => {
      const req: MockReq = { ip: "127.0.0.1", method: "GET", originalUrl: url };
      const res = makeRes(undefined);
      const next = jest.fn();
      mod.activityLogger(req as unknown as Request, res as unknown as Response, next);
      expect(res.on).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalled();
    },
  );
});
