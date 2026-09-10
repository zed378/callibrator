/**
 * Branch/line coverage tests for attachment.service.js
 *
 * Complements attachment.service.test.js — targets resolveAbsPath's traversal
 * guard, getDownload, getSignedDownload, the signed-token rejection paths and
 * the `||` defaults in createAttachment / toPublic / generateSignedUrl.
 *
 * NOTE: storagePath.util is deliberately NOT mocked here — the traversal guard
 * depends on real path.join normalisation, and a stubbed joiner would make the
 * guard untestable (it can never fail against a naive string concat).
 */

jest.mock("../../models", () => ({
  Attachment: {
    findAndCountAll: jest.fn(),
    findByPk: jest.fn(),
    create: jest.fn(),
    findOne: jest.fn(),
  },
}));

jest.mock("../../utils/upload.util", () => ({
  getUploadUrl: jest.fn((fileName, folder) => `/${folder}/${fileName}`),
}));

jest.mock("../../services/virusScan.service", () => ({
  scanFile: jest.fn(),
}));

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock("fs", () => ({
  createReadStream: jest.fn(),
  promises: { unlink: jest.fn() },
  existsSync: jest.fn(),
}));

const EventEmitter = require("events");
const path = require("path");
const fs = require("fs");
const attachmentService = require("../../services/attachment.service");
const { Attachment } = require("../../models");
const { getUploadUrl } = require("../../utils/upload.util");
const virusScan = require("../../services/virusScan.service");
const { logger } = require("../../middlewares/activityLog.middleware");
const storagePath = require("../../utils/storagePath.util");
// Real constants (not mocked) so the pagination assertions track production values.
const { DEFAULT_LIMIT } = require("../../constants");

// A readable-ish stub that emits the given chunks then "end".
const streamOf = (chunks) => {
  const emitter = new EventEmitter();
  setImmediate(() => {
    for (const c of chunks) {
      emitter.emit("data", Buffer.from(c));
    }
    emitter.emit("end");
  });
  return emitter;
};

const streamThatErrors = (err) => {
  const emitter = new EventEmitter();
  setImmediate(() => emitter.emit("error", err));
  return emitter;
};

describe("attachment.service (coverage)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    virusScan.scanFile.mockResolvedValue({ clean: true });
    fs.createReadStream.mockImplementation(() => streamOf(["hello"]));
    fs.existsSync.mockReturnValue(true);
    fs.promises.unlink.mockResolvedValue(undefined);
  });

  // ================================================================
  describe("createAttachment", () => {
    it("defaults resourceType/resourceId/uploadedBy when no meta is given", async () => {
      const created = {
        id: "att-1",
        tenantId: "t-1",
        resourceType: "generic",
        resourceId: null,
        fileName: "f.pdf",
        originalName: "F.pdf",
        mimeType: "application/pdf",
        size: 10,
        checksum: "c",
        uploadedBy: null,
        folder: "uploads/attachments",
        createdAt: new Date(),
      };
      Attachment.create.mockResolvedValue(created);

      const result = await attachmentService.createAttachment("t-1", {
        path: "/tmp/f.pdf",
        filename: "f.pdf",
        originalname: "F.pdf",
        mimetype: "application/pdf",
        size: 10,
      });

      expect(Attachment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          resourceType: "generic",
          resourceId: null,
          uploadedBy: null,
          folder: "uploads/attachments",
        }),
      );
      expect(result.resourceType).toBe("generic");
      expect(logger.info).toHaveBeenCalledWith(
        "Attachment created",
        expect.objectContaining({ attachmentId: "att-1", tenantId: "t-1" }),
      );
    });

    it("passes the supplied meta through to the model", async () => {
      Attachment.create.mockResolvedValue({
        id: "att-2",
        resourceType: "certificate",
        folder: "uploads/attachments",
        size: 1,
      });

      await attachmentService.createAttachment(
        "t-1",
        { path: "/tmp/a", filename: "a", originalname: "A", mimetype: "text/plain", size: 1 },
        { resourceType: "certificate", resourceId: "c-1", uploadedBy: "u-1" },
      );

      expect(Attachment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          resourceType: "certificate",
          resourceId: "c-1",
          uploadedBy: "u-1",
        }),
      );
    });

    it("computes a real sha256 checksum from the file stream", async () => {
      Attachment.create.mockResolvedValue({
        id: "att-3",
        folder: "uploads/attachments",
        size: 5,
      });

      await attachmentService.createAttachment("t-1", {
        path: "/tmp/f",
        filename: "f",
        originalname: "F",
        mimetype: "text/plain",
        size: 5,
      });

      // sha256("hello")
      expect(Attachment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          checksum:
            "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
        }),
      );
      expect(fs.createReadStream).toHaveBeenCalledWith("/tmp/f");
    });

    it("propagates a checksum stream error", async () => {
      fs.createReadStream.mockImplementation(() =>
        streamThatErrors(new Error("EIO: read failed")),
      );

      await expect(
        attachmentService.createAttachment("t-1", {
          path: "/tmp/f",
          filename: "f",
          originalname: "F",
          mimetype: "text/plain",
          size: 1,
        }),
      ).rejects.toThrow("EIO: read failed");
      expect(Attachment.create).not.toHaveBeenCalled();
    });

    it("falls back to 'infected' when the scanner gives no reason", async () => {
      virusScan.scanFile.mockResolvedValue({ clean: false });

      await expect(
        attachmentService.createAttachment("t-1", {
          path: "/tmp/bad",
          filename: "bad",
        }),
      ).rejects.toMatchObject({
        status: 422,
        message: "File rejected by virus scan: infected",
      });
      expect(fs.promises.unlink).toHaveBeenCalledWith("/tmp/bad");
      expect(Attachment.create).not.toHaveBeenCalled();
    });

    it("still rejects when unlinking the infected file fails", async () => {
      virusScan.scanFile.mockResolvedValue({ clean: false, reason: "Eicar-Test" });
      fs.promises.unlink.mockRejectedValue(new Error("EPERM"));

      await expect(
        attachmentService.createAttachment("t-1", {
          path: "/tmp/bad",
          filename: "bad",
        }),
      ).rejects.toMatchObject({
        status: 422,
        message: "File rejected by virus scan: Eicar-Test",
      });
    });
  });

  // ================================================================
  describe("toPublic", () => {
    it("falls back to the default folder when the record has none", async () => {
      Attachment.findOne.mockResolvedValue({
        id: "a-1",
        fileName: "x.pdf",
        folder: null,
        size: "2048",
      });

      const result = await attachmentService.getAttachment("t-1", "a-1");

      expect(getUploadUrl).toHaveBeenCalledWith("x.pdf", "uploads/attachments");
      expect(result.url).toBe("/uploads/attachments/x.pdf");
      expect(result.size).toBe(2048); // coerced from the string the driver returns
    });
  });

  // ================================================================
  describe("listAttachments", () => {
    it("falls back to DEFAULT_LIMIT when limit is not a usable number", async () => {
      Attachment.findAndCountAll.mockResolvedValue({ count: 0, rows: [] });

      const r = await attachmentService.listAttachments("t-1", { limit: "abc" });

      expect(Attachment.findAndCountAll).toHaveBeenCalledWith(
        expect.objectContaining({ limit: DEFAULT_LIMIT, offset: 0 }),
      );
      expect(r.meta.limit).toBe(DEFAULT_LIMIT);
    });

    it("computes the offset from the requested page", async () => {
      Attachment.findAndCountAll.mockResolvedValue({ count: 45, rows: [] });

      const r = await attachmentService.listAttachments("t-1", {
        page: 3,
        limit: 10,
      });

      expect(Attachment.findAndCountAll).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 10, offset: 20 }),
      );
      expect(r.meta).toEqual({ total: 45, page: 3, limit: 10, totalPages: 5 });
    });
  });

  // ================================================================
  describe("getDownload", () => {
    it("resolves the absolute path for an existing file", async () => {
      Attachment.findOne.mockResolvedValue({
        id: "a-1",
        folder: "uploads/attachments",
        fileName: "doc.pdf",
        originalName: "Doc.pdf",
        mimeType: "application/pdf",
      });

      const r = await attachmentService.getDownload("t-1", "a-1");

      expect(r).toEqual({
        absPath: storagePath("uploads", "attachments", "doc.pdf"),
        fileName: "Doc.pdf",
        mimeType: "application/pdf",
      });
      expect(Attachment.findOne).toHaveBeenCalledWith({
        where: { id: "a-1", tenantId: "t-1" },
      });
    });

    it("tolerates leading/trailing slashes in the stored folder", async () => {
      Attachment.findOne.mockResolvedValue({
        id: "a-1",
        folder: "/uploads/attachments/",
        fileName: "doc.pdf",
        originalName: "Doc.pdf",
        mimeType: "application/pdf",
      });

      const r = await attachmentService.getDownload("t-1", "a-1");

      expect(r.absPath).toBe(storagePath("uploads", "attachments", "doc.pdf"));
    });

    it("throws 410 when the file has vanished from disk", async () => {
      Attachment.findOne.mockResolvedValue({
        id: "a-1",
        folder: "uploads/attachments",
        fileName: "gone.pdf",
        originalName: "Gone.pdf",
        mimeType: "application/pdf",
      });
      fs.existsSync.mockReturnValue(false);

      await expect(
        attachmentService.getDownload("t-1", "a-1"),
      ).rejects.toMatchObject({
        status: 410,
        message: "Attachment file is no longer available",
      });
    });

    it("throws 404 when the attachment is not owned by the tenant", async () => {
      Attachment.findOne.mockResolvedValue(null);

      await expect(
        attachmentService.getDownload("t-1", "a-1"),
      ).rejects.toMatchObject({ status: 404, message: "Attachment not found" });
    });

    it("rejects a fileName that escapes the attachment folder", async () => {
      Attachment.findOne.mockResolvedValue({
        id: "a-1",
        folder: "uploads/attachments",
        fileName: `..${path.sep}..${path.sep}secrets.env`,
        originalName: "x",
        mimeType: "text/plain",
      });

      await expect(
        attachmentService.getDownload("t-1", "a-1"),
      ).rejects.toMatchObject({ status: 400, message: "Invalid attachment path" });
      expect(fs.existsSync).not.toHaveBeenCalled();
    });
  });

  // ================================================================
  describe("generateSignedUrl", () => {
    it("uses the default TTL when expiresInSec is zero or negative", async () => {
      Attachment.findOne.mockResolvedValue({ id: "a-1" });

      const r = await attachmentService.generateSignedUrl("t-1", "a-1", {
        expiresInSec: -5,
      });

      expect(r.expiresInSec).toBe(300);
    });

    it("uses the default TTL when expiresInSec is not a number", async () => {
      Attachment.findOne.mockResolvedValue({ id: "a-1" });

      const r = await attachmentService.generateSignedUrl("t-1", "a-1", {
        expiresInSec: "soon",
      });

      expect(r.expiresInSec).toBe(300);
    });

    it("honours an explicit baseUrl and strips its trailing slash", async () => {
      Attachment.findOne.mockResolvedValue({ id: "a-1" });

      const r = await attachmentService.generateSignedUrl("t-1", "a-1", {
        baseUrl: "https://files.example.com/",
      });

      expect(r.url).toMatch(
        /^https:\/\/files\.example\.com\/api\/v1\/attachments\/a-1\/signed\?token=/,
      );
    });

    it("falls back to PUBLIC_BASE_URL when no baseUrl is supplied", async () => {
      Attachment.findOne.mockResolvedValue({ id: "a-1" });
      const saved = process.env.PUBLIC_BASE_URL;
      process.env.PUBLIC_BASE_URL = "https://cdn.example.com";

      try {
        const r = await attachmentService.generateSignedUrl("t-1", "a-1");
        expect(r.url).toContain("https://cdn.example.com/api/v1/attachments/a-1/signed");
      } finally {
        if (saved === undefined) {
          delete process.env.PUBLIC_BASE_URL;
        } else {
          process.env.PUBLIC_BASE_URL = saved;
        }
      }
    });

    it("falls back to localhost when neither baseUrl nor PUBLIC_BASE_URL is set", async () => {
      Attachment.findOne.mockResolvedValue({ id: "a-1" });
      const saved = process.env.PUBLIC_BASE_URL;
      delete process.env.PUBLIC_BASE_URL;

      try {
        const r = await attachmentService.generateSignedUrl("t-1", "a-1");
        expect(r.url).toContain("http://localhost:5000/api/v1/attachments/a-1/signed");
      } finally {
        if (saved !== undefined) {
          process.env.PUBLIC_BASE_URL = saved;
        }
      }
    });

    it("returns an expiresAt consistent with the token's exp claim", async () => {
      Attachment.findOne.mockResolvedValue({ id: "a-1" });

      const r = await attachmentService.generateSignedUrl("t-1", "a-1", {
        expiresInSec: 60,
      });
      const exp = Number(r.token.split(".")[0]);

      expect(r.expiresAt).toEqual(new Date(exp * 1000));
      expect(r.expiresInSec).toBe(60);
    });

    it("throws 404 when the attachment is not owned by the tenant", async () => {
      Attachment.findOne.mockResolvedValue(null);

      await expect(
        attachmentService.generateSignedUrl("t-1", "a-1"),
      ).rejects.toMatchObject({ status: 404 });
    });
  });

  // ================================================================
  describe("_verifySignedToken", () => {
    it("rejects a missing token", () => {
      expect(attachmentService._verifySignedToken("a-1", undefined)).toBe(false);
      expect(attachmentService._verifySignedToken("a-1", "")).toBe(false);
    });

    it("rejects a non-string token", () => {
      expect(attachmentService._verifySignedToken("a-1", 12345)).toBe(false);
      expect(attachmentService._verifySignedToken("a-1", { exp: 1 })).toBe(false);
    });

    it("rejects a token with a non-numeric exp", () => {
      expect(attachmentService._verifySignedToken("a-1", "notanumber.sig")).toBe(
        false,
      );
    });

    it("rejects a token with no signature segment", () => {
      const future = Math.floor(Date.now() / 1000) + 300;
      expect(attachmentService._verifySignedToken("a-1", `${future}`)).toBe(false);
    });

    it("rejects a signature of the wrong length without a timing-unsafe compare", () => {
      const future = Math.floor(Date.now() / 1000) + 300;
      expect(attachmentService._verifySignedToken("a-1", `${future}.abc`)).toBe(
        false,
      );
    });

    it("rejects a correct-length signature signed for a different attachment", async () => {
      Attachment.findOne.mockResolvedValue({ id: "a-1" });
      const { token } = await attachmentService.generateSignedUrl("t-1", "a-1");

      expect(attachmentService._verifySignedToken("a-2", token)).toBe(false);
    });
  });

  // ================================================================
  describe("getSignedDownload", () => {
    const validTokenFor = async (id) => {
      Attachment.findOne.mockResolvedValue({ id });
      const { token } = await attachmentService.generateSignedUrl("t-1", id);
      return token;
    };

    it("resolves the download without a tenant or session", async () => {
      const token = await validTokenFor("a-1");
      Attachment.findByPk.mockResolvedValue({
        id: "a-1",
        folder: "uploads/attachments",
        fileName: "doc.pdf",
        originalName: "Doc.pdf",
        mimeType: "application/pdf",
      });

      const r = await attachmentService.getSignedDownload("a-1", token);

      expect(r).toEqual({
        absPath: storagePath("uploads", "attachments", "doc.pdf"),
        fileName: "Doc.pdf",
        mimeType: "application/pdf",
      });
      expect(Attachment.findByPk).toHaveBeenCalledWith("a-1");
    });

    it("throws 403 for an invalid token before touching the database", async () => {
      await expect(
        attachmentService.getSignedDownload("a-1", "bogus"),
      ).rejects.toMatchObject({
        status: 403,
        message: "Invalid or expired download link",
      });
      expect(Attachment.findByPk).not.toHaveBeenCalled();
    });

    it("throws 403 once a validly-signed token passes its expiry", async () => {
      // Sign a real token, then move the clock past its exp rather than
      // hand-rolling a signature (which would hard-code the signing secret).
      const token = await validTokenFor("a-1");
      const exp = Number(token.split(".")[0]);
      const nowSpy = jest.spyOn(Date, "now").mockReturnValue((exp + 1) * 1000);

      try {
        expect(attachmentService._verifySignedToken("a-1", token)).toBe(false);
        await expect(
          attachmentService.getSignedDownload("a-1", token),
        ).rejects.toMatchObject({
          status: 403,
          message: "Invalid or expired download link",
        });
      } finally {
        nowSpy.mockRestore();
      }

      expect(Attachment.findByPk).not.toHaveBeenCalled();
    });

    it("throws 404 when the signed attachment no longer exists", async () => {
      const token = await validTokenFor("a-1");
      Attachment.findByPk.mockResolvedValue(null);

      await expect(
        attachmentService.getSignedDownload("a-1", token),
      ).rejects.toMatchObject({ status: 404, message: "Attachment not found" });
    });

    it("throws 410 when the signed file has vanished from disk", async () => {
      const token = await validTokenFor("a-1");
      Attachment.findByPk.mockResolvedValue({
        id: "a-1",
        folder: "uploads/attachments",
        fileName: "gone.pdf",
        originalName: "Gone.pdf",
        mimeType: "application/pdf",
      });
      fs.existsSync.mockReturnValue(false);

      await expect(
        attachmentService.getSignedDownload("a-1", token),
      ).rejects.toMatchObject({
        status: 410,
        message: "Attachment file is no longer available",
      });
    });

    it("rejects a traversal fileName even on a validly signed link", async () => {
      const token = await validTokenFor("a-1");
      Attachment.findByPk.mockResolvedValue({
        id: "a-1",
        folder: "uploads/attachments",
        fileName: `..${path.sep}..${path.sep}secrets.env`,
        originalName: "x",
        mimeType: "text/plain",
      });

      await expect(
        attachmentService.getSignedDownload("a-1", token),
      ).rejects.toMatchObject({ status: 400, message: "Invalid attachment path" });
    });
  });
});
