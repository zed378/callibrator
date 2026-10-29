/**
 * D-22 (ADR-070) — GET /api/v1/attachments/orphans, the orphan report.
 *
 * Gated twice: a tenant administrator (rbac TENANT_ADMIN, i.e. role level 8 or
 * above) who also holds `equipment: read` — the grant every attachment read
 * needs. It reads only the caller's tenant (the service's SQL is tenant-bound;
 * attachment.cascade.d22.test.js and dataLayer.dbC.live.test.js prove it), and
 * answers in the envelope: rows in `data`, pagination in a top-level `meta`.
 *
 * The real dynamicAccess runs over the seeded matrix (roleConstants); only
 * `auth` and the service are stubbed. It has no `:id`, so no two-tenant 404
 * case applies; the two-tenant property is the live test's.
 */

interface RolesService {
  getRolePermissionsMatrix: jest.Mock;
}

interface AttachmentService {
  listOrphans: jest.Mock;
  getAttachment: jest.Mock;
}

interface RoleMenuAssignment {
  roleName: string;
  menus: Record<string, unknown>;
}

interface Constants {
  ROLE_NAMES: Record<string, string>;
  ROLE_LEVELS: Record<string, number>;
  ROLE_MENU_ASSIGNMENTS: RoleMenuAssignment[];
}

interface CurrentUser {
  id: string;
  tenantId: string;
  role: { id: string; name: string; role_level: number };
}

let currentUser: CurrentUser | null = null;

jest.mock("../../middlewares/auth.middleware", () => {
  const actual = jest.requireActual<Record<string, unknown>>("../../middlewares/auth.middleware");
  return {
    ...actual,
    auth: (req: { user?: unknown }, _res: unknown, next: () => void) => {
      req.user = currentUser;
      next();
    },
  };
});

jest.mock("../../services/roles.service", () => ({ getRolePermissionsMatrix: jest.fn() }));
jest.mock("../../services/userPermission.service", () => ({
  getUserOverrideMatrix: jest.fn(() => Promise.resolve({})),
}));
jest.mock("../../models", () => ({ Tenants: { findByPk: jest.fn() } }));
jest.mock("../../services/attachment.service", () => ({
  listOrphans: jest.fn(),
  getAttachment: jest.fn(),
}));
jest.mock("../../utils/upload.util", () => ({
  upload: () => (_req: unknown, _res: unknown, next: () => void) => {
    next();
  },
}));
jest.mock("../../middlewares/enforceQuota.middleware", () => ({
  enforceStorageQuota: () => (_req: unknown, _res: unknown, next: () => void) => {
    next();
  },
}));

/* eslint-disable @typescript-eslint/no-require-imports -- loaded after the mocks above, as every memoryDb test */
const RolesService = require("../../services/roles.service") as RolesService;
const attachmentService = require("../../services/attachment.service") as AttachmentService;
const { ROLE_NAMES, ROLE_LEVELS, ROLE_MENU_ASSIGNMENTS } = require("../../constants") as Constants;
/* eslint-enable @typescript-eslint/no-require-imports */

interface AttachmentsRouter {
  handle: (
    req: object,
    res: object,
    done: (err?: { status?: number; statusCode?: number; message?: string }) => void,
  ) => void;
}

// eslint-disable-next-line @typescript-eslint/no-require-imports -- the router is `export =` (CommonJS), loaded after the mocks
const router = require("../../routes/api/attachments.route") as AttachmentsRouter;

const TENANT = "33333333-3333-4333-8333-333333333333";

interface OrphanAnswer {
  status: number;
  body: { data?: unknown; meta?: unknown; message?: string | undefined };
}

const call = (url: string): Promise<OrphanAnswer> =>
  new Promise((resolve) => {
    const [pathname, search = ""] = url.split("?");
    const res = {
      statusCode: 200,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(payload: OrphanAnswer["body"]) {
        resolve({ status: this.statusCode, body: payload });
        return this;
      },
      send(payload: OrphanAnswer["body"]) {
        return this.json(payload);
      },
      setHeader() {
        return this;
      },
      end() {
        resolve({ status: this.statusCode, body: null as unknown as OrphanAnswer["body"] });
        return this;
      },
    };
    const req = {
      method: "GET",
      url,
      originalUrl: `/api/v1/attachments${url}`,
      path: pathname,
      body: {},
      query: Object.fromEntries(new URLSearchParams(search)),
      params: {},
      headers: {},
      ip: "127.0.0.1",
      get: () => undefined,
    };
    router.handle(req, res, (err?: { status?: number; statusCode?: number; message?: string }) => {
      resolve({ status: err ? (err.status ?? err.statusCode ?? 500) : 404, body: { message: err?.message } });
    });
  });

const matrixFor = (roleName: string): Record<string, unknown[]> => {
  const entry = ROLE_MENU_ASSIGNMENTS.find((a) => a.roleName === roleName);
  return Object.fromEntries(Object.entries(entry?.menus ?? {}).map(([slug, p]) => [slug, [p]]));
};

const levelKey = (roleName: string): string => {
  const found = Object.entries(ROLE_NAMES).find(([, name]) => name === roleName)?.[0];
  if (found === undefined) {
    throw new Error(`unknown role ${roleName}`);
  }
  return found;
};

const as = (roleName: string): void => {
  currentUser = {
    id: "u-1",
    tenantId: TENANT,
    role: { id: roleName, name: roleName, role_level: ROLE_LEVELS[levelKey(roleName)] as number },
  };
};

beforeEach(() => {
  jest.clearAllMocks();
  RolesService.getRolePermissionsMatrix.mockImplementation((roleId: string) => Promise.resolve(matrixFor(roleId)));
  attachmentService.listOrphans.mockResolvedValue({
    rows: [{ id: "a-1", reason: "parent_missing_or_deleted" }],
    meta: { total: 1, page: 1, limit: 25, totalPages: 1 },
  });
});

describe("D-22 — GET /attachments/orphans", () => {
  it.each([ROLE_NAMES["TECHNICIAN"] as string, ROLE_NAMES["SUPERVISOR"] as string, ROLE_NAMES["ENGINEERING_MANAGER"] as string])(
    "refuses %s (below tenant administrator) with 403 and never reads",
    async (role: string) => {
      as(role);
      const res = await call("/orphans");
      expect(res.status).toBe(403);
      expect(attachmentService.listOrphans).not.toHaveBeenCalled();
    },
  );

  it.each([ROLE_NAMES["HEALTCARE_ADMIN"] as string, ROLE_NAMES["CALIBRATOR_ADMIN"] as string])(
    "answers %s with the caller's tenant's orphans — rows in data, meta top-level",
    async (role: string) => {
      as(role);
      const res = await call("/orphans?page=1&limit=25");
      expect(res.status).toBe(200);
      expect(attachmentService.listOrphans).toHaveBeenCalledWith(TENANT, { page: "1", limit: "25" });
      expect(res.body.data).toEqual([{ id: "a-1", reason: "parent_missing_or_deleted" }]);
      expect(res.body.meta).toEqual({ total: 1, page: 1, limit: 25, totalPages: 1 });
      expect((res.body.data as { rows?: unknown }).rows).toBeUndefined();
    },
  );

  it("is not captured by GET /:id — 'orphans' is never read as an attachment id", async () => {
    as(ROLE_NAMES["HEALTCARE_ADMIN"] as string);
    await call("/orphans");
    expect(attachmentService.getAttachment).not.toHaveBeenCalled();
  });
});
