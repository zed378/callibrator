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
 *  - a caller that passes auditActor(req) whole carries it explicitly;
 *  - recordAudit, the best-effort after-response middleware.
 *
 * What is real: auth.middleware, auditActor.util, audit.service, roles.service,
 * auditLog.middleware#recordAudit, and the AuditLog model's schema (through the
 * auditLedger fixture). What is faked: JWT verification, the session check, the
 * user loader, the tenant context, and the database (the ledger).
 */
const { EventEmitter } = require("events");
const { Sequelize, DataTypes } = require("sequelize");
const { createLedger } = require("../fixtures/auditLedger");

const mockRef = { ledger: null };

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
  runWithSession: jest.fn((sessionId, fn) => fn()),
}));

jest.mock("../../middlewares/tenantContext.middleware", () => ({
  tenantContextMiddleware: jest.fn((req, res, next) => next()),
}));

jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));

jest.mock("../../models", () => ({
  Role: {
    create: async (values, options) => {
      mockRef.ledger.write("roles", values, options);
      return { id: "role-new", ...values };
    },
  },
  AuditLog: { create: (...args) => mockRef.ledger.AuditLog.create(...args) },
}));

jest.mock("../../config", () => ({
  db: { transaction: (...args) => mockRef.ledger.transaction(...args) },
}));

jest.mock("../../services/redis.service", () => ({
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn(async () => undefined),
  delPattern: jest.fn(),
  cacheKeys: { permissions: (id) => `perm:${id}`, userPermissions: (id) => `uperm:${id}` },
}));

const { verifyAccessToken } = require("../../utils/jwt.util");
const authService = require("../../services/auth.service");
const { auth, optionalAuth } = require("../../middlewares/auth.middleware");
const { auditActor, currentImpersonatorId } = require("../../utils/auditActor.util");
const auditService = require("../../services/audit.service");
const RolesService = require("../../services/roles.service");
const { recordAudit } = require("../../middlewares/auditLog.middleware");

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
const throughAuth = async (req, work, middleware = auth) => {
  let pending = null;
  const next = jest.fn(() => {
    pending = work(req);
  });
  await middleware(req, {}, next);
  expect(next).toHaveBeenCalledTimes(1);
  return pending;
};

const newRequest = (extra = {}) => ({
  headers: { authorization: "Bearer t", "user-agent": "UA" },
  ip: "10.0.0.7",
  ...extra,
});

const flush = () => new Promise((resolve) => setImmediate(resolve));

/**
 * No impersonator on the row. logAction leaves the attribute out rather than
 * writing an explicit null; audit_logs.impersonator_id is nullable with no
 * default, so the stored value is NULL either way.
 */
const expectNoImpersonator = (row) => {
  expect(row).toBeDefined();
  expect(row.impersonatorId ?? null).toBeNull();
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
    const rows = mockRef.ledger.auditRows();
    expect(rows).toHaveLength(1);
    // The actor is still the principal the token names — the hospital user —
    // and the row now also names who was really at the keyboard.
    expect(rows[0]).toMatchObject({
      tenantId: TENANT,
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
      await mockRef.ledger.transaction((transaction) =>
        auditService.logAction(
          { ...auditActor(r), action: "UPDATE", resourceType: "Thing", resourceId: "x" },
          { transaction },
        ),
      );
    });

    expect(mockRef.ledger.auditRows()[0]).toMatchObject({
      userId: HOSPITAL_USER,
      impersonatorId: SUPER_ADMIN,
    });
  });

  it("the best-effort recordAudit middleware records the impersonator too", async () => {
    tokenFor({ impersonatorId: SUPER_ADMIN });
    const req = newRequest({ params: { id: "dev-1" } });
    const res = Object.assign(new EventEmitter(), { statusCode: 200 });

    await throughAuth(req, async (r) => {
      recordAudit("UPDATE", "CalibrationDevice")(r, res, () => {});
    });
    res.emit("finish");
    await flush();

    expect(mockRef.ledger.auditRows()).toEqual([
      expect.objectContaining({
        userId: HOSPITAL_USER,
        impersonatorId: SUPER_ADMIN,
        resourceType: "CalibrationDevice",
        resourceId: "dev-1",
      }),
    ]);
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
    const [row] = mockRef.ledger.auditRows();
    expect(row.userId).toBe(HOSPITAL_USER);
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
    expectNoImpersonator(mockRef.ledger.auditRows()[0]);
  });

  it.each([
    ["an empty string", ""],
    ["a number", 42],
    ["an object", { id: SUPER_ADMIN }],
  ])("a claim that is %s is not an impersonator", async (_label, value) => {
    tokenFor({ impersonatorId: value });
    const req = newRequest();

    await throughAuth(req, async () => {});

    expect(req.impersonatorId).toBeNull();
  });

  it("the impersonation context ends with the request — nothing leaks into later work", async () => {
    tokenFor({ impersonatorId: SUPER_ADMIN });
    await throughAuth(newRequest(), async () => {
      expect(currentImpersonatorId()).toBe(SUPER_ADMIN);
    });

    // Outside any request (a cron job, the next request's own context).
    expect(currentImpersonatorId()).toBeNull();
    await auditService.logAction({
      tenantId: TENANT,
      userId: null,
      action: "DELETE",
      resourceType: "RetentionPurge",
    });
    expectNoImpersonator(mockRef.ledger.auditRows()[0]);
  });

  it("optionalAuth exposes the impersonator the same way", async () => {
    tokenFor({ impersonatorId: SUPER_ADMIN });
    const req = newRequest();

    await throughAuth(
      req,
      async () => {
        expect(currentImpersonatorId()).toBe(SUPER_ADMIN);
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
    expect(mockRef.ledger.auditRows()[0].impersonatorId).toBe(SUPER_ADMIN);
  });

  it("the AuditLog model persists it in audit_logs.impersonator_id (the column migration 0029 adds)", () => {
    const AuditLog = jest.requireActual("../../models/auditLog.model")(
      new Sequelize({ dialect: "postgres", logging: false }),
      DataTypes,
    );
    const attribute = AuditLog.getAttributes().impersonatorId;
    expect(attribute).toBeDefined();
    expect(attribute.field).toBe("impersonator_id");
    expect(attribute.allowNull).toBe(true);
    expect(attribute.type.key).toBe("UUID");
  });
});
