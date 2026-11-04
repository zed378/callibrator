/**
 * S-01 (critical) / ADR-042 steps 3–6 — `/uploads` was a public static mount
 * serving certificates and attachments.
 *
 * Everything here runs over a real express app, a real socket and real files
 * in a temporary storage root: the public mount exactly as index.js mounts it
 * (mountPublicUploads), the real attachment + certificate controllers and
 * services, real HMAC signing. Only the database is a double — one that
 * honours the tenant predicate, the soft-delete scope and the certificate
 * number the way the real queries do — and `auth` is a stand-in that sets
 * `req.user` from the two-tenant fixture (the gates themselves are unchanged
 * and have their own tests).
 */

import fs from "fs";
import os from "os";
import path from "path";
import http from "http";
import express from "express";
import type { Request, Response, NextFunction } from "express";

const mockStorageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "s01-storage-"));

// P8-01 (ADR-086 Amendment 1): stored files are looked for in storage first;
// the double holds none, so every file here is read from its legacy path.
jest.mock("../../services/storage", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createFakeStorage } = require("../fixtures/fakeStorage") as { createFakeStorage: () => unknown };
  return createFakeStorage();
});
jest.mock("../../utils/storagePath.util", () => (...parts: string[]) =>
  path.join(mockStorageRoot, ...parts),
);
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

interface MockAttachment {
  id: string;
  tenantId: string;
  resourceType: string;
  resourceId: string | null;
  fileName: string;
  originalName: string;
  folder: string;
  mimeType: string;
  size: number;
  isDeleted: boolean;
  save: () => Promise<void>;
  [key: string]: unknown;
}

interface MockCertificate {
  id: string;
  tenantId: string;
  certificateNumber: string;
  type: string;
  status: string;
  filePath: string;
  validUntil: Date;
  tenant: { name: string };
  verificationToken: string;
  deletedAt?: Date | null;
  [key: string]: unknown;
}

// The database double. Rows live in these arrays; lookups honour the WHERE.
const mockDb: { attachments: MockAttachment[]; certificates: MockCertificate[] } = { attachments: [], certificates: [] };
/** A-293: the certificate's verification token, as its QR code carries it. */
const VERIFY_TOKEN = "Zq3v8Xr1TtY0bN4kLmP2sW9aE6hJcF5u";
const mockMatch = (row: Record<string, unknown>, where: Record<string, unknown> = {}) =>
  Object.entries(where).every(([k, v]) => row[k] === v);

// P21-15: the e-signature collaborator is outside this suite's scope; certificateEsignatures.p2115 tests it over the real models.
jest.mock("../../services/esignatureApplication.service", () => ({ autoApplyApproval: jest.fn().mockResolvedValue(null), certificateMarks: jest.fn().mockResolvedValue([]) }));
jest.mock("../../models", () => ({
  Attachment: {
    // defaultScope { isDeleted: false } — as attachment.model.js
    findOne: jest.fn(async ({ where }: { where: Record<string, unknown> }) =>
      mockDb.attachments.find((r) => !r.isDeleted && mockMatch(r, where)) || null,
    ),
    findByPk: jest.fn(async (id: string) =>
      mockDb.attachments.find((r) => !r.isDeleted && r.id === id) || null,
    ),
  },
  Certificate: {
    findOne: jest.fn(async ({ where, paranoid }: { where: Record<string, unknown>; paranoid?: boolean }) =>
      mockDb.certificates.find(
        (r) => (paranoid === false || !r.deletedAt) && mockMatch(r, where),
      ) || null,
    ),
  },
  CalibrationDevice: {},
  // A-365: a signed link's redemption re-checks its tenant and issuer.
  Tenant: { findByPk: jest.fn(async (id: string) => ({ id, status: "active" })) },
  User: { findByPk: jest.fn(async (id: string) => ({ id, isActive: true, status: "ACTIVE" })) },
}));
jest.mock("../../config", () => ({
  db: { transaction: jest.fn(async (cb: (tx: { id: string }) => Promise<unknown>) => cb({ id: "TX" })) },
}));
jest.mock("../../services/audit.service", () => ({ logAction: jest.fn(async () => ({ id: 1 })) }));
jest.mock("../../services/virusScan.service", () => ({ scanFile: jest.fn() }));

/* eslint-disable @typescript-eslint/no-require-imports */
const { createTwoTenants } = require("../fixtures/twoTenants") as { createTwoTenants: typeof import("../fixtures/twoTenants").createTwoTenants };
const storagePath = require("../../utils/storagePath.util") as typeof import("../../utils/storagePath.util");
const { mountPublicUploads } = require("../../utils/upload.util") as typeof import("../../utils/upload.util");
const attachmentController = require("../../controllers/attachment.controller") as typeof import("../../controllers/attachment.controller");
const attachmentService = require("../../services/attachment.service") as typeof import("../../services/attachment.service");
const certificatePdfController = require("../../controllers/certificatePdf.controller") as typeof import("../../controllers/certificatePdf.controller");
/* eslint-enable @typescript-eslint/no-require-imports */

const fx = createTwoTenants();
const userA = fx.principal(fx.tenantA, "USER");
const userB = fx.principal(fx.tenantB, "USER");

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(56, 7),
]); // 64 bytes
const PDF = Buffer.from("%PDF-1.7\n" + "x".repeat(91)); // 100 bytes

const write = (rel: string, content: Buffer | string) => {
  const abs = storagePath(...rel.split("/"));
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return abs;
};

let server: http.Server;
let base: string;
let currentUser: unknown = null;

/** Raw HTTP (not fetch: undici adds no-cache to conditional requests and normalises paths). */
const get = (urlPath: string, headers: http.OutgoingHttpHeaders = {}): Promise<{ status: number | undefined; headers: http.IncomingHttpHeaders; body: Buffer }> =>
  new Promise((resolve, reject) => {
    const req = http.request(`${base}${urlPath}`, { method: "GET", headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () =>
        resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }),
      );
    });
    req.on("error", reject);
    req.end();
  });

const ATT_A = "1111aaaa-0000-4000-8000-000000000001";
const ATT_B = "2222bbbb-0000-4000-8000-000000000002";
const CERT_FILE = "1758600000000-4242-9f1c2d3e-4b5a-4c6d-8e7f-0a1b2c3d4e5f.pdf";
const CERT_NO = "CERT-20260923-ACME-0001";

beforeAll(async () => {
  process.env["CORS_ORIGIN"] = "https://app.example.test, not a url, https://x.test;script-src *";

  const app = express();
  // index.js: the ONLY static mount for uploads.
  mountPublicUploads(app);

  const asUser = (req: Request, _res: Response, next: NextFunction) => {
    (req as unknown as { user: unknown }).user = currentUser;
    next();
  };
  app.get("/api/v1/attachments/:id/signed", attachmentController.downloadSigned as express.RequestHandler);
  app.get("/api/v1/attachments/:id/download", asUser as express.RequestHandler, attachmentController.download as express.RequestHandler);
  app.get("/api/v1/certificates/verify/:certificateNumber", certificatePdfController.verifyCertificate as express.RequestHandler);
  app.get(
    "/api/v1/certificates/verify/:certificateNumber/document",
    certificatePdfController.verifyDocument as express.RequestHandler,
  );
  // asyncHandler has already answered a caught error and forwards it too, as
  // in production; the real errorHandler then leaves a sent response alone.
  app.use(((err: { status?: number; message?: string }, _req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) { return; }
    res.status(err.status || 500).json({ message: err.message });
  }) as express.ErrorRequestHandler);

  server = http.createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address() as { port: number };
  base = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
  fs.rmSync(mockStorageRoot, { recursive: true, force: true });
  delete process.env["CORS_ORIGIN"];
});

beforeEach(() => {
  jest.clearAllMocks();
  currentUser = userA;
  mockDb.attachments = [
    {
      id: ATT_A,
      tenantId: fx.tenantA.id,
      resourceType: "generic",
      resourceId: null,
      fileName: "a-photo.png",
      originalName: "gauge photo.png",
      folder: "uploads/attachments",
      mimeType: "image/png",
      size: PNG.length,
      isDeleted: false,
      save: jest.fn(async () => {}),
    },
    {
      id: ATT_B,
      tenantId: fx.tenantB.id,
      resourceType: "generic",
      resourceId: null,
      fileName: "b-report.pdf",
      originalName: "b report.pdf",
      folder: "uploads/attachments",
      mimeType: "application/pdf",
      size: PDF.length,
      isDeleted: false,
      save: jest.fn(async () => {}),
    },
  ];
  mockDb.certificates = [
    {
      id: "c-1",
      tenantId: fx.tenantB.id,
      certificateNumber: CERT_NO,
      type: "calibration",
      status: "signed",
      filePath: `certificates/${CERT_FILE}`,
      validUntil: new Date("2099-01-01"),
      tenant: { name: "Acme" },
      // A-293 (ADR-100): the full verdict — the only one with a documentUrl —
      // needs the certificate's verification token (its QR code carries it).
      verificationToken: VERIFY_TOKEN,
    },
  ];
  write("uploads/attachments/a-photo.png", PNG);
  write("uploads/attachments/b-report.pdf", PDF);
  write(`uploads/certificates/${CERT_FILE}`, PDF);
  write("uploads/.quarantine/pending.png", PNG);
  write("uploads/public/profile/avatar.png", PNG);
  write("uploads/public/tenant/logo.svg", "<svg onload=alert(1)></svg>");
  write("uploads/public/cms/page.html", "<script>alert(1)</script>");
  write("uploads/public/cms/.hidden.png", PNG);
});

describe("S-01 — the static mount serves only the public class", () => {
  it("S-01: a certificate PDF under /uploads answers 404 with no credentials", async () => {
    const res = await get(`/uploads/certificates/${CERT_FILE}`);
    expect(res.status).toBe(404);
    expect(res.body.includes(PDF)).toBe(false);
  });

  it("S-01: an attachment under /uploads answers 404", async () => {
    expect((await get("/uploads/attachments/a-photo.png")).status).toBe(404);
    expect((await get("/uploads/attachments/b-report.pdf")).status).toBe(404);
  });

  it("S-01: the quarantine is not reachable", async () => {
    expect((await get("/uploads/.quarantine/pending.png")).status).toBe(404);
  });

  it("S-01: dot-segments cannot climb out of the public root", async () => {
    for (const p of [
      `/uploads/public/../certificates/${CERT_FILE}`,
      `/uploads/public/%2e%2e/certificates/${CERT_FILE}`,
      "/uploads/public/..%2fattachments/a-photo.png",
    ]) {
      const res = await get(p);
      expect(res.status).not.toBe(200);
      expect(res.body.includes(PDF)).toBe(false);
    }
  });

  it("ADR-042 step 3: a public avatar is served with a pinned image type, nosniff and a sandbox CSP", async () => {
    const res = await get("/uploads/public/profile/avatar.png");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("image/png");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["content-security-policy"]).toBe("default-src 'none'; sandbox");
    expect(res.headers["cache-control"]).toMatch(/max-age=86400/);
    expect(res.body.equals(PNG)).toBe(true);
  });

  it("ADR-042 step 3: SVG, HTML and dotfiles in the public tree are refused", async () => {
    expect((await get("/uploads/public/tenant/logo.svg")).status).toBe(404);
    expect((await get("/uploads/public/cms/page.html")).status).toBe(404);
    expect((await get("/uploads/public/cms/.hidden.png")).status).toBe(404);
    expect((await get("/uploads/public/profile/")).status).toBe(404);
  });
});

describe("S-01 — attachments are reached only through the gated route", () => {
  it("S-01: the url an attachment response carries is the gated route, not /uploads", async () => {
    const data = await attachmentService.getAttachment(fx.tenantA.id, ATT_A);
    expect((data as { url: string }).url).toBe(`/api/v1/attachments/${ATT_A}/download`);
  });

  it("ADR-042 step 5: the owner gets it inline (an image), with ETag, Last-Modified and Accept-Ranges", async () => {
    const res = await get(`/api/v1/attachments/${ATT_A}/download`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("image/png");
    expect(res.headers["content-disposition"]).toBe(
      "inline; filename=\"gauge photo.png\"; filename*=UTF-8''gauge%20photo.png",
    );
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["cache-control"]).toBe("private, no-cache, no-transform");
    expect(res.headers.etag).toBeTruthy();
    expect(res.headers["last-modified"]).toBeTruthy();
    expect(res.headers["accept-ranges"]).toBe("bytes");
    expect(res.body.equals(PNG)).toBe(true);
  });

  it("ADR-042 step 5: If-None-Match answers 304 and Range answers 206", async () => {
    const first = await get(`/api/v1/attachments/${ATT_A}/download`);
    const cached = await get(`/api/v1/attachments/${ATT_A}/download`, {
      "If-None-Match": first.headers.etag as string,
    });
    expect(cached.status).toBe(304);

    const ranged = await get(`/api/v1/attachments/${ATT_A}/download`, { Range: "bytes=0-7" });
    expect(ranged.status).toBe(206);
    expect(ranged.headers["content-range"]).toBe(`bytes 0-7/${PNG.length}`);
    expect(ranged.body.equals(PNG.subarray(0, 8))).toBe(true);
  });

  it("S-01 two-tenant: tenant A asking for tenant B's attachment id gets 404, not 403", async () => {
    currentUser = userA;
    const res = await get(`/api/v1/attachments/${ATT_B}/download`);
    expect(res.status).toBe(404);
    expect(res.body.includes(PDF)).toBe(false);

    currentUser = userB;
    expect((await get(`/api/v1/attachments/${ATT_B}/download`)).status).toBe(200);
  });

  it("ADR-042 step 6: deleting an attachment makes its URL and its signed link stop working, and unlinks the file", async () => {
    const signed = await attachmentService.generateSignedUrl(fx.tenantA.id, ATT_A, { baseUrl: base, issuer: { userId: userA.id } });
    const signedPath = signed.url.slice(base.length);
    expect((await get(signedPath)).status).toBe(200);

    await attachmentService.deleteAttachment(fx.tenantA.id, ATT_A, { userId: userA.id });

    expect((await get(`/api/v1/attachments/${ATT_A}/download`)).status).toBe(404);
    expect((await get(signedPath)).status).toBe(404);
    expect(fs.existsSync(storagePath("uploads", "attachments", "a-photo.png"))).toBe(false);
    // The other tenant's evidence is untouched.
    expect(fs.existsSync(storagePath("uploads", "attachments", "b-report.pdf"))).toBe(true);
  });

  it("ADR-042 step 6: a delete whose transaction fails keeps both the row and the file", async () => {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { db } = require("../../config") as { db: { transaction: jest.Mock } };
    /* eslint-enable @typescript-eslint/no-require-imports */
    db.transaction.mockRejectedValueOnce(new Error("audit insert failed"));
    await expect(
      attachmentService.deleteAttachment(fx.tenantA.id, ATT_A, { userId: userA.id }),
    ).rejects.toThrow("audit insert failed");
    expect(fs.existsSync(storagePath("uploads", "attachments", "a-photo.png"))).toBe(true);
  });

  it("ADR-042 step 6: a committed delete whose file cannot be resolved is logged, not failed", async () => {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { logger } = require("../../middlewares/activityLog.middleware") as { logger: { warn: jest.Mock } };
    /* eslint-enable @typescript-eslint/no-require-imports */
    (mockDb.attachments[0] as MockAttachment).folder = "../../outside"; // resolveAbsPath refuses it
    await expect(
      attachmentService.deleteAttachment(fx.tenantA.id, ATT_A, { userId: userA.id }),
    ).resolves.toEqual({ id: ATT_A });
    expect((mockDb.attachments[0] as MockAttachment).isDeleted).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith(
      "Deleted attachment's file could not be removed",
      expect.objectContaining({ attachmentId: ATT_A }),
    );
  });

  it("a file already gone from disk answers 410 on the gated route", async () => {
    fs.rmSync(storagePath("uploads", "attachments", "a-photo.png"));
    expect((await get(`/api/v1/attachments/${ATT_A}/download`)).status).toBe(410);
  });
});

describe("S-01 — the public verification page reaches the PDF through a capability", () => {
  const verify = async (number = CERT_NO) =>
    (JSON.parse((await get(`/api/v1/certificates/verify/${number}?token=${VERIFY_TOKEN}`)).body.toString()) as { data: { valid: boolean; documentUrl: string | null } }).data;

  it("ADR-042 step 4: a signed certificate's documentUrl is a working, framable, inline PDF", async () => {
    const data = await verify();
    expect(data.valid).toBe(true);
    expect(data.documentUrl).toMatch(
      new RegExp(`^/api/v1/certificates/verify/${CERT_NO}/document\\?token=\\d+\\.[0-9a-f]{64}$`),
    );
    expect(data.documentUrl).not.toContain(CERT_FILE);

    const res = await get(data.documentUrl!);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.headers["content-disposition"]).toMatch(/^inline; filename="CERT-20260923-ACME-0001.pdf"/);
    // The verify page's <iframe> may frame it: this origin and the configured
    // frontend origin, and nothing malformed from CORS_ORIGIN.
    expect(res.headers["content-security-policy"]).toBe(
      "default-src 'none'; frame-ancestors 'self' https://app.example.test",
    );
    expect(res.headers["x-frame-options"]).toBeUndefined();
    expect(res.body.equals(PDF)).toBe(true);

    const ranged = await get(data.documentUrl!, { Range: "bytes=0-4" });
    expect(ranged.status).toBe(206);
    expect(ranged.body.toString()).toBe("%PDF-");
  });

  it("S-01: no token, a forged token, or a token for another number answers 403", async () => {
    const { documentUrl } = await verify();
    const token = (documentUrl as string).split("token=")[1] as string;
    const [exp, sig] = token.split(".") as [string, string];
    const forged = `${exp}.${sig.slice(0, -1)}${sig.endsWith("0") ? "1" : "0"}`;

    expect((await get(`/api/v1/certificates/verify/${CERT_NO}/document`)).status).toBe(403);
    expect(
      (await get(`/api/v1/certificates/verify/${CERT_NO}/document?token=${forged}`)).status,
    ).toBe(403);
    // Tenant A walks a number next to tenant B's with B's token: no document.
    expect(
      (await get(`/api/v1/certificates/verify/CERT-20260923-ACME-0002/document?token=${token}`))
        .status,
    ).toBe(403);
  });

  it("S-01: an expired token answers 403", async () => {
    const { documentUrl } = await verify();
    const realNow = Date.now;
    Date.now = () => realNow() + 2 * 3600 * 1000;
    try {
      expect((await get(documentUrl!)).status).toBe(403);
    } finally {
      Date.now = realNow;
    }
  });

  it("ADR-042 step 2+4: a draft publishes no documentUrl", async () => {
    (mockDb.certificates[0] as MockCertificate).status = "draft";
    expect((await verify()).documentUrl).toBeNull();
  });

  it("ADR-042 step 4: a certificate revoked after the link was minted stops yielding its document", async () => {
    const { documentUrl } = await verify();
    (mockDb.certificates[0] as MockCertificate).status = "revoked";
    expect((await get(documentUrl!)).status).toBe(404);
  });

  it("ADR-042 step 4: a withdrawn (soft-deleted) certificate stops yielding its document", async () => {
    const { documentUrl } = await verify();
    (mockDb.certificates[0] as MockCertificate).deletedAt = new Date();
    expect((await get(documentUrl!)).status).toBe(404);
  });

  it("a signed certificate whose file is missing answers 410", async () => {
    const { documentUrl } = await verify();
    fs.rmSync(storagePath("uploads", "certificates", CERT_FILE));
    expect((await get(documentUrl!)).status).toBe(410);
  });
});
