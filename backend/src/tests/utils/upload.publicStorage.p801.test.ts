/**
 * P8-01 (ADR-086 Amendment 1) — the public image class in platform storage:
 * the mount reads `global/<domain>/<file>` first and falls through to the
 * legacy directory; deleteUpload removes from both; a name the key grammar
 * refuses was never stored under a key. The identity of the served answer is
 * routes/storedFiles.identity.p801.
 *
 * Real express app, real static mount, the REAL local driver in a temporary
 * root (through a real ScopedStorage).
 */
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import express from "express";
import type { Request, Response, NextFunction } from "express";
import type * as StorageModule from "../../services/storage";
import type LocalDriverClass from "../../services/storage/local.driver";
import type * as UploadUtil from "../../utils/upload.util";

const mockRoot = fs.mkdtempSync(path.join(os.tmpdir(), "p801-public-"));
jest.mock("../../utils/storagePath.util", () =>
  (...parts: string[]): string => jest.requireActual<typeof path>("path").join(mockRoot, ...parts),
);
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock("../../services/storage", () => {
  const actual = jest.requireActual<typeof StorageModule>("../../services/storage");
  const LocalDriver = jest.requireActual<typeof LocalDriverClass>("../../services/storage/local.driver");
  const p = jest.requireActual<typeof path>("path");
  return {
    ...actual,
    getGlobalStorage: jest.fn(() =>
      Promise.resolve(new actual.ScopedStorage(new LocalDriver({ root: p.join(mockRoot, "store"), name: "local" }) as never, null))),
  };
});

const upload = jest.requireActual<typeof UploadUtil>("../../utils/upload.util");
const storageMock = jest.requireMock<{ getGlobalStorage: jest.Mock }>("../../services/storage");
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(24, 1)]);

let server: http.Server;
let base = "";
const call = (method: string, p: string): Promise<{ status: number; body: Buffer }> =>
  new Promise((resolve, reject) => {
    const req = http.request(`${base}${p}`, { method }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => { resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) }); });
    });
    req.on("error", reject);
    req.end();
  });
const inStore = (key: string): boolean => fs.existsSync(path.join(mockRoot, "store", ...key.split("/")));
const legacy = (rel: string): string => path.join(mockRoot, "uploads", "public", ...rel.split("/"));

beforeAll(async () => {
  const app = express();
  upload.mountPublicUploads(app);
  // Express knows an error handler by its four parameters.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: { message?: string }, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ message: err.message });
  });
  server = http.createServer(app);
  await new Promise<void>((resolve) => { server.listen(0, "127.0.0.1", resolve); });
  base = `http://127.0.0.1:${String((server.address() as { port: number }).port)}`;
});
afterAll(async () => {
  await new Promise((resolve) => { server.close(resolve); });
  fs.rmSync(mockRoot, { recursive: true, force: true });
});

describe("P8-01 — the public mount reads platform storage first", () => {
  it("serves a stored avatar; a file only in the legacy folder still comes from there", async () => {
    await (await storageMock.getGlobalStorage() as { put(k: string, b: Buffer): Promise<unknown> }).put("global/avatars/stored.png", PNG);
    fs.mkdirSync(legacy("profile"), { recursive: true });
    fs.writeFileSync(legacy("profile/old.png"), PNG);
    expect(await call("GET", "/uploads/public/profile/stored.png")).toMatchObject({ status: 200, body: PNG });
    expect(await call("GET", "/uploads/public/profile/old.png")).toMatchObject({ status: 200, body: PNG });
    expect((await call("GET", "/uploads/public/profile/neither.png")).status).toBe(404);
  });

  it("only GET and HEAD read storage; an unknown folder, a nested path or an unkeyable name is not a public file", async () => {
    expect((await call("POST", "/uploads/public/profile/stored.png")).status).toBe(404);
    expect((await call("GET", "/uploads/public/other/stored.png")).status).toBe(404);
    expect((await call("GET", "/uploads/public/profile/x/stored.png")).status).toBe(404);
    expect((await call("GET", "/uploads/public/profile/a%20b.png")).status).toBe(404);
  });

  it("a storage failure that is not 'absent' is an error, not a silent fall-through", async () => {
    storageMock.getGlobalStorage.mockRejectedValueOnce(new Error("bucket unreachable"));
    const res = await call("GET", "/uploads/public/profile/stored.png");
    expect(res.status).toBe(500);
    expect(res.body.toString()).toContain("bucket unreachable");
  });
});

describe("P8-01 — deleteUpload and publicStorageKey", () => {
  it("removes a public-class file from storage AND from the legacy folder", async () => {
    await (await storageMock.getGlobalStorage() as { put(k: string, b: Buffer): Promise<unknown> }).put("global/branding/logo.png", PNG);
    fs.mkdirSync(legacy("tenant"), { recursive: true });
    fs.writeFileSync(legacy("tenant/logo.png"), PNG);
    await upload.deleteUpload("logo.png", "uploads/public/tenant");
    expect(inStore("global/branding/logo.png")).toBe(false);
    expect(fs.existsSync(legacy("tenant/logo.png"))).toBe(false);
  });

  it("a name the key grammar refuses was never stored under a key: only the legacy file is removed", async () => {
    fs.mkdirSync(legacy("cms"), { recursive: true });
    fs.writeFileSync(legacy("cms/a b.png"), PNG);
    await upload.deleteUpload("a b.png", "uploads/public/cms");
    expect(fs.existsSync(legacy("cms/a b.png"))).toBe(false);
  });

  it("maps each public folder to its domain, and nothing else to a key", () => {
    expect(upload.publicStorageKey("uploads/public/profile", "a.png")).toBe("global/avatars/a.png");
    expect(upload.publicStorageKey("uploads/public/tenant", "a.png")).toBe("global/branding/a.png");
    expect(upload.publicStorageKey("uploads/public/cms", "a.png")).toBe("global/content/a.png");
    expect(upload.publicStorageKey("uploads/attachments", "a.png")).toBeNull();
    expect(upload.publicStorageKey("uploads/public/cms", "../a.png")).toBeNull();
  });
});
