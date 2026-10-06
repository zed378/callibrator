/**
 * P8-01 (ADR-086 Amendment 1) — IDENTITY: a file served from the storage
 * layer answers exactly as the same file served from its legacy place on
 * disk did, on every route that serves files.
 *
 * Real express app, real socket, the REAL controllers and services, the REAL
 * storage layer (services/storage → config → the local driver, rooted in a
 * temporary directory), real HMAC signing. Doubled: the database (rows in
 * arrays), Redis (the driver-cache generation reads as "none") and the audit
 * writer. For each route the SAME bytes are put in both places — once under
 * a legacy row/path, once under a storage key — and the two answers are
 * compared request by request: a plain GET, HEAD, a conditional GET with the
 * answer's own validator (304), a byte Range (206), an unsatisfiable Range
 * (416) and an If-Range that does not match (the whole file).
 *
 * The only header allowed to differ is the VALUE of ETag/Last-Modified (two
 * files, two mtimes) — and both answers must carry one.
 *
 * It also pins the cut-over's behaviour (fail-before on HEAD: every "from
 * storage" case answered from disk or 404/410, because nothing read a key):
 * an attachment uploaded now is reached by key, a deleted one is gone from
 * storage, a key naming another tenant's object is refused, and the two
 * tenants' keys never cross.
 */
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import express from "express";
import type { Request, Response, NextFunction } from "express";
import type * as StorageModule from "../../services/storage";
import type * as UploadUtil from "../../utils/upload.util";
import type * as AttachmentController from "../../controllers/attachment.controller";
import type * as AttachmentService from "../../services/attachment.service";
import type * as CertificatePdfController from "../../controllers/certificatePdf.controller";
import type * as CertificatePdfService from "../../services/certificatePdf.service";
import type * as TenantBackupController from "../../controllers/tenantBackup.controller";
import type * as GdprController from "../../controllers/gdpr.controller";

const mockRoot = fs.mkdtempSync(path.join(os.tmpdir(), "p801-identity-"));
// The platform default is the local driver, rooted in this test's directory.
// config/env reads process.env per call, so this is what the storage layer sees.
// eslint-disable-next-line no-restricted-properties -- the test sets the driver the storage layer resolves
process.env["STORAGE_DRIVER"] = "local";
// eslint-disable-next-line no-restricted-properties -- as above: the local driver's root
process.env["STORAGE_LOCAL_ROOT"] = path.join(mockRoot, "storage");

jest.mock("../../utils/storagePath.util", () =>
  (...parts: string[]): string => jest.requireActual<typeof path>("path").join(mockRoot, ...parts),
);
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock("../../services/redis.service", () => ({
  get: jest.fn(() => Promise.resolve(null)),
  set: jest.fn(() => Promise.resolve(true)),
}));
jest.mock("../../services/audit.service", () => ({ logAction: jest.fn(() => Promise.resolve({ id: "audit-1" })) }));
jest.mock("../../services/virusScan.service", () => ({ scanFile: jest.fn(() => Promise.resolve({ clean: true })) }));

interface Row extends Record<string, unknown> {
  id: string;
  tenantId: string;
}
const mockDb: { attachments: Row[]; certificates: Row[]; backups: Row[] } = { attachments: [], certificates: [], backups: [] };
const mockMatch = (row: Row, where: Record<string, unknown> = {}): boolean =>
  Object.entries(where).every(([k, v]) => row[k] === v);

jest.mock("../../models", () => ({
  Attachment: {
    findOne: jest.fn(({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(mockDb.attachments.find((r) => !r["isDeleted"] && mockMatch(r, where)) ?? null)),
    findByPk: jest.fn((id: string) => Promise.resolve(mockDb.attachments.find((r) => !r["isDeleted"] && r.id === id) ?? null)),
    create: jest.fn((values: Record<string, unknown>) => {
      const row: Row = { ...values, id: `att-${String(mockDb.attachments.length + 1)}`, tenantId: String(values["tenantId"]), createdAt: new Date(), save: () => Promise.resolve() };
      mockDb.attachments.push(row);
      return Promise.resolve(row);
    }),
  },
  Certificate: {
    findOne: jest.fn(({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(mockDb.certificates.find((r) => mockMatch(r, where)) ?? null)),
  },
  TenantBackup: {
    findByPk: jest.fn((id: string) => Promise.resolve(mockDb.backups.find((r) => r.id === id) ?? null)),
    STATUS: { COMPLETED: "COMPLETED" },
    BACKUP_TYPES: { FULL: "full" },
    DEFAULT_RETENTION_DAYS: 30,
  },
  TenantSettings: { findAll: jest.fn(() => Promise.resolve([])) },
  CalibrationDevice: {},
  Tenant: {},
  Tenants: {},
  User: {},
  Users: {},
}));
jest.mock("../../config", () => ({
  db: { transaction: jest.fn((cb: (t: object) => unknown) => Promise.resolve(cb({ id: "TX" }))) },
}));

const storage = jest.requireActual<typeof StorageModule>("../../services/storage");
const { mountPublicUploads, quarantinePath } = jest.requireActual<typeof UploadUtil>("../../utils/upload.util");
const attachmentController = jest.requireActual<typeof AttachmentController>("../../controllers/attachment.controller");
const attachmentService = jest.requireActual<typeof AttachmentService>("../../services/attachment.service");
const certificatePdfController = jest.requireActual<typeof CertificatePdfController>("../../controllers/certificatePdf.controller");
const certificatePdfService = jest.requireActual<typeof CertificatePdfService>("../../services/certificatePdf.service");
const tenantBackupController = jest.requireActual<typeof TenantBackupController>("../../controllers/tenantBackup.controller");
const gdprController = jest.requireActual<typeof GdprController>("../../controllers/gdpr.controller");

const TENANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const USER_A = "11111111-1111-4111-8111-111111111111";
const CERT_LEGACY = "c1111111-1111-4111-8111-111111111111";
const CERT_STORED = "c2222222-2222-4222-8222-222222222222";

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(120, 7)]);
const PDF = Buffer.from(`%PDF-1.7\n${"x".repeat(191)}`);
const ZIP = Buffer.concat([Buffer.from("PK\u0003\u0004"), Buffer.alloc(96, 3)]);

const disk = (rel: string, content: Buffer): void => {
  const abs = path.join(mockRoot, ...rel.split("/"));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
};
const putKey = async (tenantId: string | null, key: string, content: Buffer, contentType: string): Promise<void> => {
  const scoped = tenantId ? await storage.getTenantStorage(tenantId) : await storage.getGlobalStorage();
  await scoped.put(key, content, { contentType });
};

let server: http.Server;
let base = "";
let currentUser: { id: string; tenantId: string } | null = { id: USER_A, tenantId: TENANT_A };

interface Answer {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}
const send = (method: string, urlPath: string, headers: Record<string, string> = {}): Promise<Answer> =>
  new Promise((resolve, reject) => {
    const req = http.request(`${base}${urlPath}`, { method, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => { resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }); });
    });
    req.on("error", reject);
    req.end();
  });

/** The headers compared between the two answers (everything a client acts on). */
const COMPARED = [
  "content-type",
  "content-length",
  "content-disposition",
  "content-range",
  "accept-ranges",
  "cache-control",
  "content-security-policy",
  "x-content-type-options",
  "x-frame-options",
];

/**
 * Five requests, each sent to both URLs; the answers must match, then each
 * answers 304 to its own validator. `sameName` maps the stored file's saved-as
 * name to the legacy one's, where the two rows differ only in it.
 *
 * The ONE difference allowed, and asserted: an unsatisfiable Range. Both
 * answer 416. The legacy path's 416 came from `send` raising an error that the
 * error handler then wrote as a JSON envelope; the storage path answers as
 * /storage/object always has (ADR-042 step 5) — an empty body and
 * `Content-Range: bytes * /<size>` (RFC 9110 §15.5.17).
 */
const expectIdentical = async (legacyUrl: string, storedUrl: string, sameName: [string, string] | null = null): Promise<void> => {
  const pairs: [string, Record<string, string>][] = [
    ["GET", {}],
    ["HEAD", {}],
    ["GET", { Range: "bytes=0-9" }],
    ["GET", { Range: "bytes=2-5", "If-Range": "\"not-the-tag\"" }],
  ];
  const normal = (v: unknown): unknown => (sameName && typeof v === "string" ? v.split(sameName[0]).join(sameName[1]) : v);
  for (const [method, headers] of pairs) {
    const legacy = await send(method, legacyUrl, headers);
    const stored = await send(method, storedUrl, headers);
    const label = `${method} ${JSON.stringify(headers)}`;
    expect({ label, status: stored.status }).toEqual({ label, status: legacy.status });
    expect({ label, body: stored.body.toString("base64") }).toEqual({ label, body: legacy.body.toString("base64") });
    for (const name of COMPARED) {
      expect({ label, name, value: normal(stored.headers[name]) }).toEqual({ label, name, value: legacy.headers[name] });
    }
    expect(Boolean(stored.headers.etag)).toBe(Boolean(legacy.headers.etag));
    expect(Boolean(stored.headers["last-modified"])).toBe(Boolean(legacy.headers["last-modified"]));
  }
  const unsatisfiable = { Range: "bytes=900000-900010" };
  const legacy416 = await send("GET", legacyUrl, unsatisfiable);
  const stored416 = await send("GET", storedUrl, unsatisfiable);
  expect([legacy416.status, stored416.status]).toEqual([416, 416]);
  expect(stored416.headers["content-range"]).toMatch(/^bytes \*\/\d+$/);
  expect(stored416.body.length).toBe(0);
  // Conditional: each answers 304 to its OWN validator.
  for (const url of [legacyUrl, storedUrl]) {
    const first = await send("GET", url);
    const again = await send("GET", url, { "If-None-Match": String(first.headers.etag) });
    expect({ url, status: again.status, body: again.body.length }).toEqual({ url, status: 304, body: 0 });
  }
};

beforeAll(async () => {
  // eslint-disable-next-line no-restricted-properties -- the frame-ancestors the certificate document allows
  process.env["CORS_ORIGIN"] = "https://app.example.test";
  storage.invalidateAll();
  const app = express();
  mountPublicUploads(app);
  const asUser = (req: Request, _res: Response, next: NextFunction): void => {
    (req as unknown as { user: unknown }).user = currentUser;
    next();
  };
  app.get("/att/:id/download", asUser, attachmentController.download);
  app.get("/att/:id/signed", attachmentController.downloadSigned);
  app.get("/cert/:certificateId/pdf", asUser, certificatePdfController.downloadPdf);
  app.get("/cert/verify/:certificateNumber/document", certificatePdfController.verifyDocument);
  app.get("/backups/:backupId/download", asUser, tenantBackupController.downloadBackup);
  app.get("/gdpr/exports/:exportId/download", asUser, gdprController.downloadExport);
  // Express knows an error handler by its four parameters.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: { status?: number; message?: string }, _req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) {return;}
    res.status(err.status ?? 500).json({ message: err.message });
  });
  server = http.createServer(app);
  await new Promise<void>((resolve) => { server.listen(0, "127.0.0.1", resolve); });
  base = `http://127.0.0.1:${String((server.address() as { port: number }).port)}`;
});

afterAll(async () => {
  await new Promise((resolve) => { server.close(resolve); });
  fs.rmSync(mockRoot, { recursive: true, force: true });
  /* eslint-disable no-restricted-properties -- restore what beforeAll and the module top set */
  delete process.env["CORS_ORIGIN"];
  delete process.env["STORAGE_LOCAL_ROOT"];
  /* eslint-enable no-restricted-properties */
});

beforeEach(() => {
  currentUser = { id: USER_A, tenantId: TENANT_A };
  mockDb.attachments = [];
  mockDb.certificates = [];
  mockDb.backups = [];
});

describe("P8-01 identity — an attachment", () => {
  beforeEach(async () => {
    disk("uploads/attachments/legacy.png", PNG);
    await putKey(TENANT_A, `t/${TENANT_A}/attachments/stored.png`, PNG, "image/png");
    const row = { tenantId: TENANT_A, originalName: "gauge.png", mimeType: "image/png", folder: "uploads/attachments" };
    mockDb.attachments.push(
      { id: "legacy", fileName: "legacy.png", storageKey: null, ...row },
      { id: "stored", fileName: "stored.png", storageKey: `t/${TENANT_A}/attachments/stored.png`, ...row },
    );
  });

  it("GET /attachments/:id/download — the stored object answers as the file on disk did", async () => {
    await expectIdentical("/att/legacy/download", "/att/stored/download");
  });

  it("GET /attachments/:id/signed — the same, through a signed link", async () => {
    const legacy = await attachmentService.generateSignedUrl(TENANT_A, "legacy", { baseUrl: "" });
    const stored = await attachmentService.generateSignedUrl(TENANT_A, "stored", { baseUrl: "" });
    const local = (url: string): string => {
      const u = new URL(url);
      return `${u.pathname}${u.search}`.replace("/api/v1/attachments", "/att");
    };
    await expectIdentical(local(legacy.url), local(stored.url));
  });

  it("a keyed row whose object is gone is 410, as a legacy row whose file is gone", async () => {
    fs.rmSync(path.join(mockRoot, "uploads", "attachments", "legacy.png"));
    await (await storage.getTenantStorage(TENANT_A)).delete(`t/${TENANT_A}/attachments/stored.png`);
    expect((await send("GET", "/att/legacy/download")).status).toBe(410);
    expect((await send("GET", "/att/stored/download")).status).toBe(410);
  });

  it("another tenant's row is 404 on both, and a key naming another tenant's namespace is refused by the guard", async () => {
    currentUser = { id: USER_A, tenantId: TENANT_B };
    expect((await send("GET", "/att/stored/download")).status).toBe(404);
    // A tampered row: tenant B's row naming tenant A's key.
    mockDb.attachments.push({
      id: "tampered", tenantId: TENANT_B, fileName: "x.png", originalName: "x.png", mimeType: "image/png",
      folder: "uploads/attachments", storageKey: `t/${TENANT_A}/attachments/stored.png`,
    });
    const res = await send("GET", "/att/tampered/download");
    expect(res.status).toBe(403);
    expect(res.body.includes(PNG)).toBe(false);
  });

  it("upload → download → delete, through the storage layer end to end", async () => {
    fs.mkdirSync(quarantinePath(), { recursive: true });
    const q = quarantinePath("new-upload.pdf");
    fs.writeFileSync(q, PDF);
    const created = await attachmentService.createAttachment(
      TENANT_A,
      { path: q, filename: "new-upload.pdf", originalname: "Evidence.pdf", mimetype: "application/pdf", size: PDF.length },
      { uploadedBy: USER_A },
    );
    const key = `t/${TENANT_A}/attachments/new-upload.pdf`;
    expect(mockDb.attachments.at(-1)).toMatchObject({ storageKey: key });
    expect(fs.existsSync(q)).toBe(false);
    expect(fs.readFileSync(path.join(mockRoot, "storage", ...key.split("/")))).toEqual(PDF);

    const got = await send("GET", `/att/${String(created["id"])}/download`);
    expect(got.status).toBe(200);
    expect(got.body).toEqual(PDF);
    expect(got.headers["content-disposition"]).toBe("inline; filename=\"Evidence.pdf\"; filename*=UTF-8''Evidence.pdf");

    await attachmentService.deleteAttachment(TENANT_A, String(created["id"]), { userId: USER_A });
    expect(fs.existsSync(path.join(mockRoot, "storage", ...key.split("/")))).toBe(false);
  });
});

describe("P8-01 identity — a certificate's stored PDF", () => {
  beforeEach(async () => {
    disk("uploads/certificates/legacy.pdf", PDF);
    // The migration tool's key for a certificate whose filePath is certificates/stored.pdf.
    await putKey(TENANT_A, `t/${TENANT_A}/certificates/stored.pdf`, PDF, "application/pdf");
    const row = { tenantId: TENANT_A, status: "signed" };
    mockDb.certificates.push(
      { id: CERT_LEGACY, certificateNumber: "CERT-L", filePath: "certificates/legacy.pdf", ...row },
      { id: CERT_STORED, certificateNumber: "CERT-S", filePath: "certificates/stored.pdf", ...row },
    );
  });

  it("GET /certificates/:id/pdf — the migrated PDF answers as res.download of the file did", async () => {
    await expectIdentical(`/cert/${CERT_LEGACY}/pdf`, `/cert/${CERT_STORED}/pdf`, ["CERT-S", "CERT-L"]);
  });

  it("GET /certificates/verify/:number/document — the same for the public capability", async () => {
    const doc = (n: string): string => certificatePdfService.mintDocumentUrl(n).replace("/api/v1/certificates", "/cert");
    await expectIdentical(doc("CERT-L"), doc("CERT-S"), ["CERT-S", "CERT-L"]);
  });
});

describe("P8-01 identity — the public image class", () => {
  it("/uploads/public/<folder>/<file> from platform storage answers as express.static did", async () => {
    disk("uploads/public/profile/legacy.png", PNG);
    await putKey(null, "global/avatars/stored.png", PNG, "image/png");
    await expectIdentical("/uploads/public/profile/legacy.png", "/uploads/public/profile/stored.png");
  });
});

describe("P8-01 identity — a tenant backup and a GDPR export", () => {
  it("GET /backups/:id/download — a stored backup answers as res.download of the file did", async () => {
    disk("backup/tenant-backups/tenant_a_legacy.zip", ZIP);
    await putKey(TENANT_A, `t/${TENANT_A}/backups/tenant_a_stored.zip`, ZIP, "application/zip");
    const row = { tenantId: TENANT_A, status: "COMPLETED", fileSize: ZIP.length };
    mockDb.backups.push(
      { id: "b-legacy", filePath: path.join(mockRoot, "backup", "tenant-backups", "tenant_a_legacy.zip"), ...row },
      { id: "b-stored", filePath: `t/${TENANT_A}/backups/tenant_a_stored.zip`, ...row },
    );
    // Same saved-as name for both, so their Content-Disposition can match.
    fs.renameSync(path.join(mockRoot, "backup", "tenant-backups", "tenant_a_legacy.zip"), path.join(mockRoot, "backup", "tenant-backups", "tenant_a_stored.zip"));
    (mockDb.backups[0] as Row)["filePath"] = path.join(mockRoot, "backup", "tenant-backups", "tenant_a_stored.zip");
    await expectIdentical("/backups/b-legacy/download", "/backups/b-stored/download");
  });

  it("GET /gdpr/exports/:id/download — a stored export answers as res.download of the file did", async () => {
    const manifest = (id: string): Buffer => Buffer.from(JSON.stringify({
      exportId: id, tenantId: TENANT_A, userId: USER_A, createdAt: "2026-10-01T00:00:00.000Z", expiresAt: "2099-01-01T00:00:00.000Z",
    }));
    const legacyId = "export-1790000000000-0a1b2c3d";
    const storedId = "export-1790000000001-0a1b2c3e";
    disk(`exports/${legacyId}.json`, manifest(legacyId));
    disk(`exports/${legacyId}.zip`, ZIP);
    await putKey(TENANT_A, `t/${TENANT_A}/exports/${storedId}.json`, manifest(storedId), "application/json");
    await putKey(TENANT_A, `t/${TENANT_A}/exports/${storedId}.zip`, ZIP, "application/zip");
    const legacy = await send("GET", `/gdpr/exports/${legacyId}/download`);
    const stored = await send("GET", `/gdpr/exports/${storedId}/download`);
    expect([legacy.status, stored.status]).toEqual([200, 200]);
    expect(stored.body).toEqual(legacy.body);
    for (const name of ["content-type", "content-length", "cache-control"]) {
      expect({ name, value: stored.headers[name] }).toEqual({ name, value: legacy.headers[name] });
    }
    expect(stored.headers["content-disposition"]).toBe(`attachment; filename="${storedId}.zip"`);
    // Another tenant's principal: the same 404 as an unknown id.
    currentUser = { id: USER_A, tenantId: TENANT_B };
    expect((await send("GET", `/gdpr/exports/${storedId}/download`)).status).toBe(404);
  });
});
