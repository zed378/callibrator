/**
 * ADR-042 step 3 (S-01) — POST /api/v1/content/media is the ONLY way a CMS
 * image becomes public, so the gate must run before multer writes anything.
 *
 * Driven through the real content router and the REAL dynamicAccess over the
 * seeded role/menu matrix; `auth` sets the principal, and upload() is replaced
 * by a recorder so "never reached" is provable.
 */
let currentUser = null;
const mockUploadCalls = [];

jest.mock("../../middlewares/auth.middleware", () => {
  const actual = jest.requireActual("../../middlewares/auth.middleware");
  return {
    ...actual,
    auth: (req, res, next) => {
      req.user = currentUser;
      next();
    },
  };
});
jest.mock("../../services/roles.service", () => ({ getRolePermissionsMatrix: jest.fn() }));
jest.mock("../../services/userPermission.service", () => ({
  getUserOverrideMatrix: jest.fn().mockResolvedValue({}),
}));
jest.mock("../../services/contentMedia.service", () => ({ recordMediaUpload: jest.fn() }));
jest.mock("../../utils/upload.util", () => {
  const actual = jest.requireActual("../../utils/upload.util");
  return {
    ...actual,
    upload: (options) => (req, res, next) => {
      mockUploadCalls.push(options);
      req.file = { filename: "f.png" };
      next();
    },
  };
});

const http = require("http");
const express = require("express");
const RolesService = require("../../services/roles.service");
const contentMediaService = require("../../services/contentMedia.service");
const { ROLE_NAMES, ROLE_MENU_ASSIGNMENTS } = require("../../constants");

let server;
let base;

const matrixFor = (roleName) => {
  const entry = ROLE_MENU_ASSIGNMENTS.find((a) => a.roleName === roleName);
  const matrix = {};
  for (const [slug, permission] of Object.entries(entry.menus)) {
    matrix[slug] = [permission];
  }
  return matrix;
};

const asRole = (roleName) => {
  currentUser = {
    id: "11111111-1111-4111-8111-111111111111",
    tenantId: "33333333-3333-4333-8333-333333333333",
    role: { id: roleName, name: roleName },
  };
};

beforeAll(async () => {
  const app = express();
  app.use("/api/v1/content", require("../../routes/api/content.route"));
  app.use((err, _req, res, _next) => {
    if (res.headersSent) {return;}
    res.status(err.status || 500).json({ message: err.message });
  });
  // The options upload() was built with, captured at router construction.
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
afterAll(() => new Promise((resolve) => server.close(resolve)));

beforeEach(() => {
  jest.clearAllMocks();
  mockUploadCalls.length = 0;
  RolesService.getRolePermissionsMatrix.mockImplementation(async (roleId) => matrixFor(roleId));
});

const post = async () => {
  const res = await fetch(`${base}/api/v1/content/media`, { method: "POST" });
  return { status: res.status, body: await res.json() };
};

describe("ADR-042 step 3 — POST /api/v1/content/media", () => {
  it("refuses a tenant administrator (no content grant) before any file is written", async () => {
    asRole(ROLE_NAMES.HEALTCARE_ADMIN);
    const res = await post();
    expect(res.status).toBe(403);
    expect(mockUploadCalls).toHaveLength(0);
    expect(contentMediaService.recordMediaUpload).not.toHaveBeenCalled();
  });

  it("lets the platform content author upload into the public CMS folder, images only", async () => {
    asRole(ROLE_NAMES.SUPER_ADMIN);
    contentMediaService.recordMediaUpload.mockResolvedValue({ url: "/uploads/public/cms/f.png" });
    const res = await post();
    expect(res.status).toBe(201);
    expect(res.body.data.url).toBe("/uploads/public/cms/f.png");
    expect(mockUploadCalls).toHaveLength(1);
    expect(mockUploadCalls[0]).toMatchObject({
      folder: "uploads/public/cms",
      allowedMimes: ["image/jpeg", "image/png", "image/gif", "image/webp"],
      allowedExtensions: [".jpg", ".jpeg", ".png", ".gif", ".webp"],
    });
    expect(mockUploadCalls[0].allowedMimes).not.toContain("image/svg+xml");
  });
});
