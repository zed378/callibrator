/**
 * F-8 (TASKS/DEBATE-owner-questions-A-compliance.md §0) — a change made while
 * impersonating names the impersonating super admin in its audit row.
 *
 * impersonateUser (auth.service.js) puts `impersonatorId` into the access token
 * it issues for the hospital user. Nothing read it back: auditActor(req)
 * recorded req.user.id, so every mutation a super admin made while
 * impersonating was audited AS THE HOSPITAL USER, and only the session's LOGIN
 * row connected the two.
 *
 * The chain under test, end to end:
 *   verified token claim → auth middleware (req.impersonatorId + the request's
 *   impersonation context) → audit.service.logAction → the audit row's
 *   `impersonatorId` column.
 *
 * Three write paths, because services build their audit entry differently:
 *  - roles.service picks `userId`/`ipAddress`/`userAgent` off the actor and
 *    passes nothing else — like certificate, e-signature, attachment and tenant
 *    services. It is attributed through the request context, with no change
 *    to the service;
 *  - a caller that passes auditActor(req) whole carries it explicitly.
 *  (The best-effort after-response `recordAudit` middleware was removed
 *  2026-10-01: no route mounted it.)
 *
 * What is real: auth.middleware, auditActor.util, audit.service, roles.service,
 * and the AuditLog model's schema (through the
 * auditLedger fixture). What is faked: JWT verification, the session check, the
 * user loader, the tenant context, and the database (the ledger).
 */
import { Sequelize, DataTypes } from "sequelize";
import { PLATFORM_TENANT_ID } from "../../constants/platformTenant";
import { SYSTEM_ACTORS } from "../../constants/systemActors";

interface AuditLedger {
  write: (table: string, values: unknown, options?: unknown) => void;
  AuditLog: { create: (...args: unknown[]) => unknown };
  transaction: <T>(fn: (t: unknown) => Promise<T>) => Promise<T>;
  auditRows: () => Record<string, unknown>[];
  committed: (table: string) => Record<string, unknown>[];
}

const mockRef: { ledger: AuditLedger | null } = { ledger: null };

jest.mock("../../utils/jwt.util", () => ({
  verifyAccessToken: jest.fn(),
}));

jest.mock("../../utils/response.util", () => ({
  unauthorized: jest.fn(),
  forbidden: jest.fn(),
}));

jest.mock("../../services/auth.service", () => ({
  getAuthUserWithTenant: jest.fn(),
}));

jest.mock("../../services/tenant.service", () => ({
  getTenantByCodeForMiddleware: jest.fn(),
  getTenantByIdForMiddleware: jest.fn(),
}));

jest.mock("../../services/apiKey.service", () => ({
  verifyApiKey: jest.fn(),
}));

jest.mock("../../services/session.service", () => ({
  isSessionLive: jest.fn().mockResolvedValue(true),
  runWithSession: jest.fn((_sessionId: unknown, fn: () => unknown) => fn()),
}));

jest.mock("../../middlewares/tenantContext.middleware", () => ({
  tenantContextMiddleware: jest.fn((_req: unknown, _res: unknown, next: () => void) => {
    next();
  }),
}));

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

jest.mock("../../models", () => ({
  Role: {
    create: (values: Record<string, unknown>, options?: unknown) => {
      mockRef.ledger?.write("roles", values, options);
      return Promise.resolve({ id: "role-new", ...values });
    },
  },
  AuditLog: { create: (...args: unknown[]) => mockRef.ledger?.AuditLog.create(...args) },
}));

jest.mock("../../config", () => ({
  db: {
    transaction: (...args: unknown[]) =>
      (mockRef.ledger?.transaction as ((...a: unknown[]) => unknown) | undefined)?.(...args),
  },
}));

jest.mock("../../services/redis.service", () => ({
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(() => Promise.resolve(undefined)),
  delPattern: jest.fn(),
  cacheKeys: { permissions: (id: string) => `perm:${id}`, userPermissions: (id: string) => `uperm:${id}` },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createLedger } = require("../fixtures/auditLedger") as { createLedger: () => AuditLedger };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { verifyAccessToken } = require("../../utils/jwt.util") as { verifyAccessToken: jest.Mock };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const authService = require("../../services/auth.service") as { getAuthUserWithTenant: jest.Mock };
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { auth, optionalAuth } = require("../../middlewares/auth.middleware") as {
  auth: (req: unknown, res: unknown, next: () => void) => Promise<unknown>;
  optionalAuth: (req: unknown, res: unknown, next: () => void) => Promise<unknown>;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { auditActor, currentImpersonatorId } = require("../../utils/auditActor.util") as {
  auditActor: (req: unknown) => Record<string, unknown>;
  currentImpersonatorId: () => string | null;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const auditService = require("../../services/audit.service") as {
  logAction: (action: Record<string, unknown>, opts?: Record<string, unknown>) => Promise<unknown>;
};
// eslint-disable-next-line @typescript-eslint/no-require-imports
const RolesService = require("../../services/roles.service") as {
  createRole: (role: Record<string, unknown>, actor: Record<string, unknown>) => Promise<unknown>;
};

const HOSPITAL_USER = "11111111-1111-4111-8111-111111111111";
const SUPER_ADMIN = "99999999-9999-4999-8999-999999999999";
const TENANT = "22222222-2222-4222-8222-222222222222";

const hospitalUser = () => ({
  id: HOSPITAL_USER,
  isActive: true,
  status: "ACTIVE",
  tenantId: TENANT,
  tenant: { id: TENANT, status: "ACTIVE" },
  role: { name: "TENANT_ADMIN" },
});

/** An access token for the hospital user; `claims` adds to what was signed. */
const tokenFor = (claims = {}) =>
  verifyAccessToken.mockReturnValue({ id: HOSPITAL_USER, sid: "sess-1", ...claims });

/**
 * Run `work(req)` as the route handler behind `auth`, and wait for it. auth
 * does not await next(), so the handler's promise is captured here.
 */
const throughAuth = async (
  req: unknown,
  work: (r: unknown) => unknown,
  middleware: (req: unknown, res: unknown, next: () => void) => Promise<unknown> = auth,
) => {
  let pending: unknown = null;
  const next = jest.fn(() => {
    pending = work(req);
  });
  await middleware(req, {}, next);
  expect(next).toHaveBeenCalledTimes(1);
  return pending;
};

interface MockReq {
  headers: Record<string, string>;
  ip: string;
  impersonatorId?: string | null;
  body?: Record<string, unknown>;
  query?: Record<string, unknown>;
  [key: string]: unknown;
}

const newRequest = (extra: Record<string, unknown> = {}): MockReq => ({
  headers: { authorization: "Bearer t", "user-agent": "UA" },
  ip: "10.0.0.7",
  ...extra,
});

/**
 * No impersonator on the row. logAction leaves the attribute out rather than
 * writing an explicit null; audit_logs.impersonator_id is nullable with no
 * default, so the stored value is NULL either way.
 */
const expectNoImpersonator = (row: Record<string, unknown> | undefined) => {
  expect(row).toBeDefined();
  expect(row?.["impersonatorId"] ?? null).toBeNull();
};

beforeEach(() => {
  jest.clearAllMocks();
  mockRef.ledger = createLedger();
  authService.getAuthUserWithTenant.mockResolvedValue(hospitalUser());
});

describe("F-8: a change made while impersonating names the impersonator", () => {
  it("a change made while impersonating records the impersonating super admin", async () => {
    tokenFor({ impersonatorId: SUPER_ADMIN });
    const req = newRequest();

    // roles.service passes only userId/ipAddress/userAgent to logAction — the
    // shape most services have. It is not edited for F-8.
    await throughAuth(req, (r) =>
      RolesService.createRole({ name: "Auditor", roleLevel: 3 }, auditActor(r)),
    );

    expect(req.impersonatorId).toBe(SUPER_ADMIN);
    const rows = mockRef.ledger?.auditRows() ?? [];
    expect(rows).toHaveLength(1);
    // The actor is still the principal the token names — the hospital user —
    // and the row now also names who was really at the keyboard.
    expect(rows[0]).toMatchObject({
      // A-125: a global role change is recorded under PLATFORM (ADR-051 Q-14).
      tenantId: PLATFORM_TENANT_ID,
      userId: HOSPITAL_USER,
      impersonatorId: SUPER_ADMIN,
      action: "CREATE",
      resourceType: "Role",
    });
  });

  it("auditActor(req) carries the impersonator, for a caller that passes the actor whole", async () => {
    tokenFor({ impersonatorId: SUPER_ADMIN });
    const req = newRequest();

    await throughAuth(req, async (r) => {
      expect(auditActor(r)).toEqual({
        userId: HOSPITAL_USER,
        tenantId: TENANT,
        impersonatorId: SUPER_ADMIN,
        ipAddress: "10.0.0.7",
        userAgent: "UA",
      });
      await mockRef.ledger?.transaction((transaction) =>
        auditService.logAction(
          { ...auditActor(r), action: "UPDATE", resourceType: "Thing", resourceId: "x" },
          { transaction },
        ),
      );
    });

    expect(mockRef.ledger?.auditRows()[0]).toMatchObject({
      userId: HOSPITAL_USER,
      impersonatorId: SUPER_ADMIN,
    });
  });

  it("a normal request records no impersonator", async () => {
    tokenFor();
    const req = newRequest();

    await throughAuth(req, (r) =>
      RolesService.createRole({ name: "Auditor", roleLevel: 3 }, auditActor(r)),
    );

    expect(req.impersonatorId).toBeNull();
    // The ordinary actor keeps its four-field shape.
    expect(auditActor(req)).toEqual({
      userId: HOSPITAL_USER,
      tenantId: TENANT,
      ipAddress: "10.0.0.7",
      userAgent: "UA",
    });
    const row = mockRef.ledger?.auditRows()[0];
    expect(row?.["userId"]).toBe(HOSPITAL_USER);
    expectNoImpersonator(row);
  });

  it("only the verified token claim is read — never the body, a header or a query", async () => {
    tokenFor();
    const req = newRequest({
      body: { impersonatorId: SUPER_ADMIN },
      query: { impersonatorId: SUPER_ADMIN },
    });
    req.headers["x-impersonator-id"] = SUPER_ADMIN;

    await throughAuth(req, (r) =>
      RolesService.createRole({ name: "Auditor", roleLevel: 3 }, auditActor(r)),
    );

    expect(req.impersonatorId).toBeNull();
    expectNoImpersonator(mockRef.ledger?.auditRows()[0]);
  });

  it.each([
    ["an empty string", ""],
    ["a number", 42],
    ["an object", { id: SUPER_ADMIN }],
  ])("a claim that is %s is not an impersonator", async (_label, value) => {
    tokenFor({ impersonatorId: value });
    const req = newRequest();

    await throughAuth(req, () => Promise.resolve());

    expect(req.impersonatorId).toBeNull();
  });

  it("the impersonation context ends with the request — nothing leaks into later work", async () => {
    tokenFor({ impersonatorId: SUPER_ADMIN });
    await throughAuth(newRequest(), () => {
      expect(currentImpersonatorId()).toBe(SUPER_ADMIN);
      return Promise.resolve();
    });

    // Outside any request (a cron job, the next request's own context).
    expect(currentImpersonatorId()).toBeNull();
    await auditService.logAction({
      tenantId: TENANT,
      systemActor: SYSTEM_ACTORS.RETENTION_PURGE, // A-124: a job is a system actor
      action: "DELETE",
      resourceType: "RetentionPurge",
    });
    expectNoImpersonator(mockRef.ledger?.auditRows()[0]);
  });

  it("optionalAuth exposes the impersonator the same way", async () => {
    tokenFor({ impersonatorId: SUPER_ADMIN });
    const req = newRequest();

    await throughAuth(
      req,
      () => {
        expect(currentImpersonatorId()).toBe(SUPER_ADMIN);
        return Promise.resolve();
      },
      optionalAuth,
    );

    expect(req.impersonatorId).toBe(SUPER_ADMIN);
  });

  it("an explicit impersonatorId passed to logAction is recorded as given", async () => {
    await auditService.logAction({
      tenantId: TENANT,
      userId: HOSPITAL_USER,
      impersonatorId: SUPER_ADMIN,
      action: "UPDATE",
      resourceType: "Thing",
    });
    expect(mockRef.ledger?.auditRows()[0]?.["impersonatorId"]).toBe(SUPER_ADMIN);
  });

  it("the AuditLog model persists it in audit_logs.impersonator_id (the column migration 0029 adds)", () => {
    interface ModelAttribute {
      field?: string;
      allowNull?: boolean;
      type: { key: string };
    }
    interface ModelDouble {
      getAttributes: () => Record<string, ModelAttribute>;
    }
    const auditLogModelFactory = jest.requireActual<(s: unknown, d: unknown) => ModelDouble>(
      "../../models/auditLog.model",
    );
    const AuditLog = auditLogModelFactory(
      new Sequelize({ dialect: "postgres", logging: false }),
      DataTypes,
    );
    const attribute = AuditLog.getAttributes()["impersonatorId"];
    expect(attribute).toBeDefined();
    expect(attribute?.field).toBe("impersonator_id");
    expect(attribute?.allowNull).toBe(true);
    expect(attribute?.type.key).toBe("UUID");
  });
});
