/**
 * S-17 — uploads land in a quarantine the static mount does not serve, and
 * reach their public folder only after they have passed.
 *
 * Before: multer wrote each upload straight into its destination folder —
 * `uploads/attachments`, inside the public `/uploads` mount — and the
 * magic-byte check and the virus scan ran on a file that was already
 * world-readable at its final URL. A rejected file was removed afterwards,
 * and a magic-byte mismatch on a single upload was not removed at all.
 *
 * Everything here is real: multer, express.static with the exact options
 * index.js mounts (UPLOADS_STATIC_OPTIONS), an HTTP server, and the disk —
 * a temporary storage root that storagePath points at.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const express = require("express");

const mockStorageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "s17-storage-"));

jest.mock("../../utils/storagePath.util", () => (...parts) =>
  require("path").join(mockStorageRoot, ...parts),
);

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

// attachment.service collaborators — the database is not what is under test.
jest.mock("../../models", () => ({
  Attachment: { create: jest.fn() },
  Certificate: { findOne: jest.fn() },
}));
jest.mock("../../config", () => ({
  db: { transaction: jest.fn(async (cb) => cb("TX")) },
}));
jest.mock("../../services/audit.service", () => ({ logAction: jest.fn() }));
jest.mock("../../services/virusScan.service", () => ({ scanFile: jest.fn() }));

const {
  upload,
  promoteFromQuarantine,
  quarantinePath,
  QUARANTINE_DIRNAME,
  UPLOADS_STATIC_OPTIONS,
} = require("../../utils/upload.util");
const storagePath = require("../../utils/storagePath.util");
const attachmentService = require("../../services/attachment.service");
const virusScan = require("../../services/virusScan.service");
const { Attachment } = require("../../models");
const { db } = require("../../config");

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

let server;
let base;
let onHeld = async () => {};

const listFiles = (...parts) => {
  const dir = storagePath(...parts);
  return fs.existsSync(dir)
    ? fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name)
    : [];
};

const post = async (route, name, type, content) => {
  const form = new globalThis.FormData();
  form.append("file", new globalThis.Blob([content], { type }), name);
  const res = await fetch(`${base}${route}`, { method: "POST", body: form });
  return { status: res.status, body: await res.json() };
};

beforeAll(async () => {
  const app = express();
  app.use("/uploads", express.static(storagePath("uploads"), UPLOADS_STATIC_OPTIONS));

  // A route that holds the file in quarantine for its service, as the
  // attachments route does.
  app.post(
    "/held",
    upload({
      folder: "uploads/attachments",
      allowedMimes: ["text/plain"],
      allowedExtensions: [".txt"],
      validateMagicBytes: false,
      holdInQuarantine: true,
    }),
    async (req, res, next) => {
      try {
        res.json(await onHeld(req.file));
      } catch (err) {
        next(err);
      }
    },
  );

  // A route that does not hold (avatars, logos): promoted by the middleware.
  app.post(
    "/direct",
    upload({ folder: "uploads/profile" }),
    (req, res) => res.json({ path: req.file.path, filename: req.file.filename }),
  );

  app.use((err, req, res, _next) => res.status(err.status || 500).json({ message: err.message }));

  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(mockStorageRoot, { recursive: true, force: true });
});

beforeEach(() => {
  jest.clearAllMocks();
  onHeld = async () => ({});
});

describe("S-17 — the quarantine and the static mount", () => {
  it("multer writes into uploads/.quarantine, which the /uploads mount answers 404 for", async () => {
    let seen;
    onHeld = async (file) => {
      const name = path.basename(file.path);
      const q = await fetch(`${base}/uploads/${QUARANTINE_DIRNAME}/${name}`);
      const final = await fetch(`${base}/uploads/attachments/${name}`);
      seen = {
        dir: path.dirname(file.path),
        onDisk: fs.existsSync(file.path),
        quarantineStatus: q.status,
        finalStatus: final.status,
      };
      await promoteFromQuarantine(file, "uploads/attachments");
      return { name };
    };

    const { status, body } = await post("/held", "note.txt", "text/plain", "hello");

    expect(status).toBe(200);
    expect(seen.dir).toBe(quarantinePath());
    expect(seen.onDisk).toBe(true);
    // Present on disk, and unreachable by URL — both where it is and where it
    // is going — while it is being vetted.
    expect(seen.quarantineStatus).toBe(404);
    expect(seen.finalStatus).toBe(404);

    // After promotion it is served, and the quarantine is empty.
    const after = await fetch(`${base}/uploads/attachments/${body.name}`);
    expect(after.status).toBe(200);
    expect(await after.text()).toBe("hello");
    expect(after.headers.get("x-content-type-options")).toBe("nosniff");
    expect(listFiles("uploads", QUARANTINE_DIRNAME)).toEqual([]);
  });

  it("UPLOADS_STATIC_OPTIONS keeps dotfiles ignored", () => {
    expect(UPLOADS_STATIC_OPTIONS.dotfiles).toBe("ignore");
    expect(Object.isFrozen(UPLOADS_STATIC_OPTIONS)).toBe(true);
  });

  it("a route that does not hold is promoted by the middleware after the magic-byte check", async () => {
    const { status, body } = await post("/direct", "a.png", "image/png", PNG);

    expect(status).toBe(200);
    expect(body.path).toBe(path.join(storagePath("uploads/profile"), body.filename));
    expect(listFiles("uploads", "profile")).toContain(body.filename);
    expect(listFiles("uploads", QUARANTINE_DIRNAME)).toEqual([]);
  });

  it("a magic-byte mismatch is refused and leaves no file anywhere", async () => {
    const before = listFiles("uploads", "profile");

    const { status, body } = await post("/direct", "fake.png", "image/png", "not a png at all");

    expect(status).toBe(400);
    expect(body.message).toMatch(/^File content does not match declared type/);
    expect(listFiles("uploads", QUARANTINE_DIRNAME)).toEqual([]);
    expect(listFiles("uploads", "profile")).toEqual(before);
  });

  it("promoteFromQuarantine refuses a file that is not in quarantine", async () => {
    const outside = storagePath("uploads", "attachments", "already-public.txt");
    fs.mkdirSync(path.dirname(outside), { recursive: true });
    fs.writeFileSync(outside, "x");

    await expect(
      promoteFromQuarantine({ path: outside, filename: "already-public.txt" }, "uploads/profile"),
    ).rejects.toMatchObject({ status: 500 });
    expect(fs.existsSync(outside)).toBe(true);
  });
});

describe("S-17 — attachment.service scans the file IN quarantine, then promotes it", () => {
  const quarantined = (name, content) => {
    fs.mkdirSync(quarantinePath(), { recursive: true });
    const p = quarantinePath(name);
    fs.writeFileSync(p, content);
    return {
      path: p,
      filename: name,
      originalname: name,
      mimetype: "text/plain",
      size: Buffer.byteLength(content),
    };
  };
  const finalPath = (name) => storagePath("uploads", "attachments", name);

  beforeEach(() => {
    Attachment.create.mockImplementation(async (row) => ({ id: "att-1", ...row }));
  });

  it("the scan sees the file in quarantine and NOT at its public path; a clean file is promoted", async () => {
    const file = quarantined("clean-1.txt", "hello");
    let during;
    virusScan.scanFile.mockImplementation(async (p) => {
      during = {
        scannedPath: p,
        inQuarantine: fs.existsSync(quarantinePath("clean-1.txt")),
        public: fs.existsSync(finalPath("clean-1.txt")),
      };
      return { clean: true };
    });

    const created = await attachmentService.createAttachment("t-1", file, { uploadedBy: "u-1" });

    expect(during).toEqual({
      scannedPath: quarantinePath("clean-1.txt"),
      inQuarantine: true,
      public: false,
    });
    expect(fs.existsSync(finalPath("clean-1.txt"))).toBe(true);
    expect(fs.existsSync(quarantinePath("clean-1.txt"))).toBe(false);
    expect(created.fileName).toBe("clean-1.txt");
    expect(created.url).toBe("/uploads/attachments/clean-1.txt");
  });

  it("an infected file is refused 422 and leaves no file anywhere", async () => {
    const file = quarantined("bad-1.txt", "EICAR-ish");
    virusScan.scanFile.mockResolvedValue({ clean: false, reason: "Eicar-Test-Signature FOUND" });

    await expect(attachmentService.createAttachment("t-1", file, {})).rejects.toMatchObject({
      status: 422,
    });
    expect(fs.existsSync(quarantinePath("bad-1.txt"))).toBe(false);
    expect(fs.existsSync(finalPath("bad-1.txt"))).toBe(false);
  });

  it("a failed transaction removes the promoted file", async () => {
    const file = quarantined("tx-1.txt", "hello");
    virusScan.scanFile.mockResolvedValue({ clean: true });
    db.transaction.mockRejectedValueOnce(new Error("insert failed"));

    await expect(attachmentService.createAttachment("t-1", file, {})).rejects.toThrow(
      "insert failed",
    );
    expect(fs.existsSync(finalPath("tx-1.txt"))).toBe(false);
    expect(fs.existsSync(quarantinePath("tx-1.txt"))).toBe(false);
  });

  it("a file that did not come through quarantine is refused, and removed", async () => {
    fs.mkdirSync(storagePath("uploads", "elsewhere"), { recursive: true });
    const p = storagePath("uploads", "elsewhere", "stray.txt");
    fs.writeFileSync(p, "x");
    virusScan.scanFile.mockResolvedValue({ clean: true });

    await expect(
      attachmentService.createAttachment("t-1", {
        path: p,
        filename: "stray.txt",
        originalname: "stray.txt",
        mimetype: "text/plain",
        size: 1,
      }, {}),
    ).rejects.toMatchObject({ status: 500 });
    expect(fs.existsSync(p)).toBe(false);
    expect(Attachment.create).not.toHaveBeenCalled();
  });
});
