import { EventEmitter } from "events";
import express, { type Request, type Response, type NextFunction } from "express";
import http, { type IncomingHttpHeaders } from "http";
import { type AddressInfo } from "net";
import { Readable } from "stream";

jest.mock("../../services/storageSettings.service", () => ({
  getSettings: jest.fn(),
  updateSettings: jest.fn(),
  clearSettings: jest.fn(),
  testConnection: jest.fn(),
  getUsage: jest.fn(),
}));
jest.mock("../../services/storage", () => ({
  openSignedObject: jest.fn(),
}));
jest.mock("../../utils/response.util", () => ({
  success: jest.fn(
    (
      res: { status: (code: number) => { json: (body: unknown) => unknown } },
      data: unknown,
      meta: unknown,
      message: string,
      status?: number,
    ) => {
      res.status(status ?? 200).json({ success: true, data, meta, message });
    },
  ),
}));

interface SettingsServiceDouble {
  getSettings: jest.Mock;
  updateSettings: jest.Mock;
  clearSettings: jest.Mock;
  testConnection: jest.Mock;
  getUsage: jest.Mock;
}

interface StorageDouble {
  openSignedObject: jest.Mock;
}

type Handler = (req: unknown, res: unknown, next?: unknown) => unknown;

interface StorageControllerDouble {
  getSettings: Handler;
  updateSettings: Handler;
  clearSettings: Handler;
  testConnection: Handler;
  getUsage: Handler;
  serveSigned: Handler;
  getObject: Handler;
  _entityTag: (meta: unknown) => string | undefined;
}

interface ResponseUtilDouble {
  success: jest.Mock;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const settingsService = require("../../services/storageSettings.service") as SettingsServiceDouble;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const storage = require("../../services/storage") as StorageDouble;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const controller = require("../../controllers/storage.controller") as StorageControllerDouble;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
const { success } = require("../../utils/response.util") as ResponseUtilDouble;

interface FakeReq {
  query: Record<string, unknown>;
  params: Record<string, unknown>;
  body: Record<string, unknown>;
  user?: Record<string, unknown> | null;
  file?: unknown;
  files?: unknown;
  headers?: Record<string, unknown>;
  ip?: string;
  protocol?: string;
  get?: jest.Mock;
  validated?: unknown;
}

interface FakeRes {
  status: jest.Mock;
  json: jest.Mock;
  setHeader: jest.Mock;
  end: jest.Mock;
  destroy: jest.Mock;
  headersSent: boolean;
}

interface HttpResult {
  status: number | undefined;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

const TENANT = "tenant-1";
let req: FakeReq;
let res: FakeRes;
let next: jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  req = { query: {}, params: {}, body: {}, user: { id: "u1", tenantId: TENANT } };
  res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    setHeader: jest.fn(),
    end: jest.fn(),
    destroy: jest.fn(),
    headersSent: false,
  };
  next = jest.fn();
});

describe("storage.controller — settings", () => {
  it("getSettings returns the tenant view", async () => {
    settingsService.getSettings.mockResolvedValue({ provider: "s3" });
    await controller.getSettings(req, res, next);
    expect(settingsService.getSettings).toHaveBeenCalledWith(TENANT);
    expect(success).toHaveBeenCalledWith(
      res,
      { provider: "s3" },
      null,
      "Storage settings retrieved",
      200,
    );
  });

  it("updateSettings passes the body through", async () => {
    req.body = { provider: "s3", bucket: "b" };
    settingsService.updateSettings.mockResolvedValue({ provider: "s3" });
    await controller.updateSettings(req, res, next);
    expect(settingsService.updateSettings).toHaveBeenCalledWith(
      TENANT,
      req.body,
      expect.objectContaining({ apiKeyId: null }),
    );
    expect(success).toHaveBeenCalledWith(
      res,
      { provider: "s3" },
      null,
      "Storage settings updated",
      200,
    );
  });

  it("clearSettings reverts to default", async () => {
    settingsService.clearSettings.mockResolvedValue({ provider: "default" });
    await controller.clearSettings(req, res, next);
    expect(settingsService.clearSettings).toHaveBeenCalledWith(
      TENANT,
      expect.objectContaining({ apiKeyId: null }),
    );
  });

  it("testConnection reports health", async () => {
    settingsService.testConnection.mockResolvedValue({ ok: true });
    await controller.testConnection(req, res, next);
    expect(success).toHaveBeenCalledWith(
      res,
      { ok: true },
      null,
      "Storage connection tested",
      200,
    );
  });

  it("getUsage reports usage", async () => {
    settingsService.getUsage.mockResolvedValue({ bytes: 10 });
    await controller.getUsage(req, res, next);
    expect(success).toHaveBeenCalledWith(
      res,
      { bytes: 10 },
      null,
      "Storage usage retrieved",
      200,
    );
  });

  it("forwards a service error to next()", async () => {
    settingsService.getSettings.mockRejectedValue(new Error("boom"));
    await controller.getSettings(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: "boom" }));
  });
});

// ADR-042 step 5 (S-01): getObject is exercised through a REAL express app,
// because what it had to gain — req.fresh, req.range, the headers a browser
// acts on — only exists on a real request/response.
describe("storage.controller — getObject (public stream, ADR-042 step 5)", () => {
  const BODY = Buffer.from("0123456789abcdefghij"); // 20 bytes
  const MTIME = new Date("2026-09-01T10:00:00Z");

  const app = express();
  app.get("/object", controller.getObject);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- express error middleware requires 4 parameters
  app.use((err: { status?: number; message?: string }, _req: Request, response: Response, _next: NextFunction) =>
    response.status(err.status ?? 500).json({ message: err.message }),
  );

  let server: http.Server;
  let base: string;
  beforeAll(async () => {
    server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => { resolve(); })));

  /** A minimal supertest-alike over a real socket (no new dependency). */
  const request = () => {
    const call = (method: string, url: string) => {
      const headers: Record<string, string | undefined> = {};
      // http.request, not fetch: undici adds `cache-control: no-cache` to a
      // conditional request, which (correctly) defeats req.fresh.
      const exec = (): Promise<HttpResult> =>
        new Promise((resolve, reject) => {
          const r = http.request(`${base}${url}`, { method, headers }, (resp) => {
            const chunks: Buffer[] = [];
            resp.on("data", (c: Buffer) => chunks.push(c));
            resp.on("end", () => { resolve({ status: resp.statusCode, headers: resp.headers, body: Buffer.concat(chunks) }); },
            );
          });
          r.on("error", reject);
          r.end();
        });
      const chain: PromiseLike<HttpResult> & {
        set: (k: string, v: string | undefined) => typeof chain;
      } = {
        set(k: string, v: string | undefined) {
          headers[k] = v;
          return chain;
        },
        then(ok, fail) {
          return exec().then(ok, fail);
        },
      };
      return chain;
    };
    return { get: (u: string) => call("GET", u), head: (u: string) => call("HEAD", u) };
  };

  /** Mock the façade: metadata, and an open(range) that slices BODY. */
  const serve = (meta: Record<string, unknown> = {}) => {
    const open = jest.fn((range: { start: number; end: number } | null) =>
      Promise.resolve(Readable.from([range ? BODY.subarray(range.start, range.end + 1) : BODY])),
    );
    storage.openSignedObject.mockResolvedValue({
      meta: { key: "t/tenant-1/attachments/a.pdf", size: BODY.length, modifiedAt: MTIME, ...meta },
      open,
    });
    return open;
  };

  it("ADR-042: streams a PDF inline with ETag, Last-Modified, Accept-Ranges and hardened headers", async () => {
    serve({ contentType: "application/pdf" });
    const response = await request().get("/object?key=t/tenant-1/attachments/a.pdf&token=tok");

    expect(storage.openSignedObject).toHaveBeenCalledWith("t/tenant-1/attachments/a.pdf", "tok");
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toBe("application/pdf");
    expect(response.headers["content-length"]).toBe("20");
    expect(response.headers["content-disposition"]).toBe(
      "inline; filename=\"a.pdf\"; filename*=UTF-8''a.pdf",
    );
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["cache-control"]).toBe("private, no-cache, no-transform");
    expect(response.headers["accept-ranges"]).toBe("bytes");
    expect(response.headers.etag).toBe(`W/"14-${MTIME.getTime().toString(16)}"`);
    expect(response.headers["last-modified"]).toBe(MTIME.toUTCString());
    expect(Buffer.from(response.body).toString()).toBe(BODY.toString());
  });

  it("ADR-042: a non-inline-safe type is served as an attachment in a sandbox", async () => {
    serve({ key: "t/tenant-1/attachments/sheet.xlsx", contentType: null });
    const response = await request().get("/object?key=k&token=tok");
    expect(response.headers["content-type"]).toBe("application/octet-stream");
    expect(response.headers["content-disposition"]).toMatch(/^attachment; filename="sheet.xlsx"/);
    expect(response.headers["content-security-policy"]).toBe(
      "default-src 'none'; sandbox; frame-ancestors 'none'",
    );
  });

  it("ADR-042: a local object with no recorded type takes it from an allowlisted extension", async () => {
    serve({ key: "t/tenant-1/attachments/photo.png", contentType: null });
    const response = await request().get("/object?key=k&token=tok");
    expect(response.headers["content-type"]).toBe("image/png");
    expect(response.headers["content-disposition"]).toMatch(/^inline;/);
  });

  it("ADR-042: If-None-Match with the ETag answers 304 without opening the object", async () => {
    const open = serve({ contentType: "application/pdf" });
    const first = await request().get("/object?key=k&token=tok");
    const response = await request()
      .get("/object?key=k&token=tok")
      .set("If-None-Match", first.headers.etag);
    expect(response.status).toBe(304);
    expect(open).toHaveBeenCalledTimes(1); // only the first request opened it
  });

  it("ADR-042: If-Modified-Since at the mtime answers 304", async () => {
    serve({ contentType: "application/pdf", etag: null });
    const response = await request()
      .get("/object?key=k&token=tok")
      .set("If-Modified-Since", MTIME.toUTCString());
    expect(response.status).toBe(304);
  });

  it("ADR-042: uses the driver's own ETag (S3) when it has one", async () => {
    serve({ etag: '"s3etag"', contentType: "image/jpeg" });
    const response = await request().get("/object?key=k&token=tok");
    expect(response.headers.etag).toBe('"s3etag"');
  });

  it("ADR-042: a single Range answers 206 with Content-Range and only those bytes", async () => {
    const open = serve({ contentType: "application/pdf" });
    const response = await request().get("/object?key=k&token=tok").set("Range", "bytes=5-9");
    expect(response.status).toBe(206);
    expect(response.headers["content-range"]).toBe("bytes 5-9/20");
    expect(response.headers["content-length"]).toBe("5");
    expect(open).toHaveBeenCalledWith({ start: 5, end: 9 });
    expect(Buffer.from(response.body).toString()).toBe("56789");
  });

  it("ADR-042: an unsatisfiable Range answers 416 with the size", async () => {
    const open = serve({ contentType: "application/pdf" });
    const response = await request().get("/object?key=k&token=tok").set("Range", "bytes=50-60");
    expect(response.status).toBe(416);
    expect(response.headers["content-range"]).toBe("bytes */20");
    expect(open).not.toHaveBeenCalled();
  });

  it("ADR-042: a multi-range or malformed Range gets the whole object", async () => {
    const open = serve({ contentType: "application/pdf" });
    const multi = await request().get("/object?key=k&token=tok").set("Range", "bytes=0-1,5-6");
    expect(multi.status).toBe(200);
    const bad = await request().get("/object?key=k&token=tok").set("Range", "pages=1");
    expect(bad.status).toBe(200);
    expect(open).toHaveBeenCalledWith(null);
  });

  it("ADR-042: If-Range that does not match the validator ignores Range", async () => {
    serve({ contentType: "application/pdf" });
    const response = await request()
      .get("/object?key=k&token=tok")
      .set("Range", "bytes=0-1")
      .set("If-Range", '"stale"');
    expect(response.status).toBe(200);
    expect(response.headers["content-length"]).toBe("20");
  });

  it("ADR-042: If-Range matching the ETag keeps the Range", async () => {
    serve({ contentType: "application/pdf" });
    const first = await request().get("/object?key=k&token=tok");
    const response = await request()
      .get("/object?key=k&token=tok")
      .set("Range", "bytes=0-1")
      .set("If-Range", first.headers.etag);
    expect(response.status).toBe(206);
  });

  it("HEAD answers the headers without opening the object", async () => {
    const open = serve({ contentType: "application/pdf" });
    const response = await request().head("/object?key=k&token=tok");
    expect(response.status).toBe(200);
    expect(response.headers["content-length"]).toBe("20");
    expect(open).not.toHaveBeenCalled();
  });

  it("omits Content-Length, Accept-Ranges and validators when the driver reports none", async () => {
    serve({ key: undefined, size: null, modifiedAt: null, contentType: null });
    const response = await request().get("/object?key=global/branding/logo.bin&token=tok");
    expect(response.status).toBe(200);
    expect(response.headers["accept-ranges"]).toBeUndefined();
    expect(response.headers.etag).toBeUndefined();
    expect(response.headers["last-modified"]).toBeUndefined();
    // The request key names the download when the stat carried none.
    expect(response.headers["content-disposition"]).toMatch(/filename="logo.bin"/);
  });

  it("forwards a rejected token (403 from the service) without writing anything", async () => {
    storage.openSignedObject.mockRejectedValue(
      Object.assign(new Error("Invalid or expired download link"), { status: 403 }),
    );
    const response = await request().get("/object?key=k&token=bad");
    expect(response.status).toBe(403);
    expect(response.headers["content-disposition"]).toBeUndefined();
  });
});

describe("storage.controller — getObject stream failures", () => {
  interface MockStream extends EventEmitter {
    pipe: jest.Mock;
  }

  const makeStream = (): MockStream => {
    const s = new EventEmitter() as MockStream;
    s.pipe = jest.fn();
    return s;
  };
  const asReq = () => ({
    ...req,
    method: "GET",
    headers: {},
    fresh: false,
    range: jest.fn(),
  });
  const asRes = () => ({ ...res, getHeader: jest.fn(), removeHeader: jest.fn() });

  it("410s when the object vanishes before headers are sent", async () => {
    const stream = makeStream();
    const r = asRes();
    storage.openSignedObject.mockResolvedValue({ meta: {}, open: () => Promise.resolve(stream) });
    await controller.getObject({ ...asReq(), query: { key: "k", token: "t" } }, r, next);

    stream.emit("error", new Error("gone"));
    expect(r.status).toHaveBeenCalledWith(410);
    expect(r.end).toHaveBeenCalled();
  });

  it("destroys the connection when the object vanishes mid-stream", async () => {
    const stream = makeStream();
    const r = { ...asRes(), headersSent: true };
    storage.openSignedObject.mockResolvedValue({ meta: {}, open: () => Promise.resolve(stream) });
    await controller.getObject({ ...asReq(), query: { key: "k", token: "t" } }, r, next);

    stream.emit("error", new Error("gone"));
    expect(r.destroy).toHaveBeenCalled();
  });
});

// P8-01: the validator moved to fileResponse.util#entityTag; the controller
// keeps `_entityTag` as the same function under its old name.
describe("storage.controller — _entityTag", () => {
  it("is fileResponse.util#entityTag", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded after the jest.mock factories above
    const { entityTag } = require("../../utils/fileResponse.util") as {
      entityTag: (meta: unknown) => string | undefined;
    };
    const meta = { size: 10, modifiedAt: new Date(0) };
    expect(controller._entityTag(meta)).toBe(entityTag(meta));
    expect(controller._entityTag({ etag: "\"abc\"" })).toBe("\"abc\"");
  });
});
