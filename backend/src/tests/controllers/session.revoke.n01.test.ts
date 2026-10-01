/**
 * N-01 — super-admin session revocation was unreachable.
 *
 * `session.route.js` gates revoke / revoke-all / delete with
 * `rbac(["SUPERADMIN"])`, and the seeded role is named
 * `ROLE_NAMES.SUPER_ADMIN` ("SUPERADMIN"). The controller then compared
 * `req.user.role?.name === "SUPER_ADMIN"` — the OTHER spelling — so a seeded
 * super admin got 403 on revoke-all and could revoke or delete only its own
 * sessions. The old unit tests mocked `role: { name: "SUPER_ADMIN" }`, the
 * spelling no seed produces ("a mock invents the contract").
 *
 * Here the principal carries the REAL seeded name, read from roleConstants,
 * and the real controller and response envelope run; only the Sessions model
 * is doubled. Fail-before: every case below with ROLE_NAMES.SUPER_ADMIN
 * answered 403.
 */
import type { Request, Response } from "express";
import type * as RoleConstants from "../../constants/roleConstants";

const mockSessions = {
  findByPk: jest.fn(),
  update: jest.fn(),
};

jest.mock("../../models", () => ({
  Sessions: mockSessions,
  Users: { unscoped: () => ({ findByPk: jest.fn().mockResolvedValue(null) }) },
  Roles: {},
  Tenants: {},
  // A-324: the session change and its audit row share a transaction.
  sequelize: { transaction: (cb: (tx: string) => unknown) => cb("TX") },
}));
// A-324: the audit row itself is proved by session.audit.a324.test.ts.
jest.mock("../../services/audit.service", () => ({ logAction: jest.fn().mockResolvedValue({}) }));

type Handler = (req: Request, res: Response, next: (err?: unknown) => void) => Promise<void>;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- the controller is JavaScript (CommonJS)
const controller = require("../../controllers/session.controller") as Record<string, Handler>;
const { ROLE_NAMES } = jest.requireActual<typeof RoleConstants>("../../constants/roleConstants");

const OPERATOR_ID = "a0100000-0000-4000-8000-000000000001";
const OTHER_USER_ID = "a0100000-0000-4000-8000-000000000002";
const SESSION_ID = "a0100000-0000-4000-8000-000000000003";

interface Answer {
  status: number;
  body: Record<string, unknown>;
}

const run = (handler: string, req: Partial<Request>): Promise<Answer> =>
  new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      headersSent: false,
      status(code: number) {
        res.statusCode = code;
        return res;
      },
      json(payload: Record<string, unknown>) {
        res.headersSent = true;
        resolve({ status: res.statusCode, body: payload });
        return res;
      },
      setHeader() {
        return res;
      },
    };
    const fn = controller[handler];
    if (!fn) {
      throw new Error(`no handler ${handler}`);
    }
    void fn(req as Request, res as unknown as Response, (err?: unknown) => {
      reject(err instanceof Error ? err : new Error(String(err)));
    });
  });

const principal = (roleName: string): Partial<Request> => {
  const req: Partial<Request> = {};
  Object.assign(req, { user: { id: OPERATOR_ID, tenantId: null, role: { name: roleName } } });
  return req;
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe("N-01 — the seeded super admin can revoke another user's sessions", () => {
  it("the seeded name is SUPERADMIN (the spelling this test uses is the real one)", () => {
    expect(ROLE_NAMES.SUPER_ADMIN).toBe("SUPERADMIN");
  });

  it.each([ROLE_NAMES.SUPER_ADMIN, "SUPER_ADMIN"])("revoke-all by %s is 200 and revokes that user's sessions", async (roleName) => {
    mockSessions.update.mockResolvedValue([2]);
    const answer = await run("revokeAllUserSessions", {
      ...principal(roleName),
      params: { userId: OTHER_USER_ID },
      body: {},
    });
    expect(answer.status).toBe(200);
    expect(answer.body).toMatchObject({ success: true, data: { revokedCount: 2 } });
    expect(mockSessions.update).toHaveBeenCalledWith(
      expect.objectContaining({ is_revoked: true }),
      { where: { user_id: OTHER_USER_ID, is_revoked: false }, transaction: "TX" },
    );
  });

  it("revoke-all by a non-super-admin is still 403 (defence in depth behind the rbac gate)", async () => {
    const answer = await run("revokeAllUserSessions", {
      ...principal("HEALTHCARE ADMIN"),
      params: { userId: OTHER_USER_ID },
      body: {},
    });
    expect(answer.status).toBe(403);
    expect(mockSessions.update).not.toHaveBeenCalled();
  });

  it("revoke of ANOTHER user's session by the seeded super admin is 200", async () => {
    const update = jest.fn().mockResolvedValue(undefined);
    mockSessions.findByPk.mockResolvedValue({ id: SESSION_ID, user_id: OTHER_USER_ID, is_revoked: false, update });
    const answer = await run("revokeSession", {
      ...principal(ROLE_NAMES.SUPER_ADMIN),
      params: { id: SESSION_ID },
      body: {},
    });
    expect(answer.status).toBe(200);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ is_revoked: true, is_active: false }), { transaction: "TX" });
  });

  it("delete of ANOTHER user's revoked session by the seeded super admin is 200", async () => {
    const destroy = jest.fn().mockResolvedValue(undefined);
    mockSessions.findByPk.mockResolvedValue({ id: SESSION_ID, user_id: OTHER_USER_ID, is_revoked: true, destroy });
    const answer = await run("deleteSession", {
      ...principal(ROLE_NAMES.SUPER_ADMIN),
      params: { id: SESSION_ID },
    });
    expect(answer.status).toBe(200);
    expect(destroy).toHaveBeenCalled();
  });
});
