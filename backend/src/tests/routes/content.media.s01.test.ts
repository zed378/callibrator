/**
 * ADR-042 step 3 (S-01) — POST /api/v1/content/media is the ONLY way a CMS
 * image becomes public, so the gate must run before multer writes anything.
 *
 * Driven through the real content router and the REAL dynamicAccess over the
 * seeded role/menu matrix; `auth` sets the principal, and upload() is replaced
 * by a recorder so "never reached" is provable.
 */
import type { Request, Response, NextFunction } from "express";
import type { AddressInfo } from "net";
import http from "http";
import express from "express";
import { ROLE_NAMES, ROLE_MENU_ASSIGNMENTS } from "../../constants";

interface UserPrincipal {
  id: string;
  tenantId: string;
  role: { id: string; name: string };
}

interface RolesServiceMock {
  getRolePermissionsMatrix: jest.Mock;
}

interface ContentMediaServiceMock {
  recordMediaUpload: jest.Mock;
}

let currentUser: UserPrincipal | null = null;
const mockUploadCalls: Record<string, unknown>[] = [];

jest.mock("../../middlewares/auth.middleware", () => {
  const actual = jest.requireActual<Record<string, unknown>>("../../middlewares/auth.middleware");
  return {
    ...actual,
    auth: (req: Request, _res: Response, next: NextFunction) => {
      (req as unknown as { user: UserPrincipal | null }).user = currentUser;
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
  const actual = jest.requireActual<Record<string, unknown>>("../../utils/upload.util");
  return {
    ...actual,
    upload: (options: Record<string, unknown>) => (req: Request, _res: Response, next: NextFunction) => {
      mockUploadCalls.push(options);
      (req as unknown as { file: { filename: string } }).file = { filename: "f.png" };
      next();
    },
  };
});

const RolesService = jest.requireMock<RolesServiceMock>("../../services/roles.service");
const contentMediaService = jest.requireMock<ContentMediaServiceMock>("../../services/contentMedia.service");

let server: http.Server;
let base: string;

const matrixFor = (roleName: string): Record<string, string[]> => {
  const entry = ROLE_MENU_ASSIGNMENTS.find((a) => a.roleName === roleName);
  const matrix: Record<string, string[]> = {};
  if (entry) {
    for (const [slug, permission] of Object.entries(entry.menus)) {
      matrix[slug] = [permission];
    }
  }
  return matrix;
};

const asRole = (roleName: string): void => {
  currentUser = {
    id: "11111111-1111-4111-8111-111111111111",
    tenantId: "33333333-3333-4333-8333-333333333333",
    role: { id: roleName, name: roleName },
  };
};

beforeAll(async () => {
  const app = express();
  app.use("/api/v1/content", jest.requireActual<express.Router>("../../routes/api/content.route"));
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Express error handler needs 4 parameters
  app.use((err: { status?: number; message?: string }, _req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) {return;}
    res.status(err.status ?? 500).json({ message: err.message });
  });
  // The options upload() was built with, captured at router construction.
  server = http.createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => { resolve(); });
  });
  base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});
afterAll(() => new Promise<void>((resolve) => {
  server.close(() => { resolve(); });
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockUploadCalls.length = 0;
  RolesService.getRolePermissionsMatrix.mockImplementation((roleId: string) => Promise.resolve(matrixFor(roleId)));
});

const post = async (): Promise<{ status: number; body: { data?: { url?: string }; message?: string } }> => {
  const res = await fetch(`${base}/api/v1/content/media`, { method: "POST" });
  return { status: res.status, body: (await res.json()) as { data?: { url?: string }; message?: string } };
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
    expect(res.body.data?.url).toBe("/uploads/public/cms/f.png");
    expect(mockUploadCalls).toHaveLength(1);
    const call = mockUploadCalls[0];
    expect(call).toMatchObject({
      folder: "uploads/public/cms",
      allowedMimes: ["image/jpeg", "image/png", "image/gif", "image/webp"],
      allowedExtensions: [".jpg", ".jpeg", ".png", ".gif", ".webp"],
    });
    if (call) {
      expect((call["allowedMimes"] as string[])).not.toContain("image/svg+xml");
    }
  });
});
