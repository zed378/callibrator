/**
 * A-37 (ADR-075, Q-18 for SCIM) — SCIM user creation was a cross-tenant
 * existence oracle.
 *
 * `users.email` / `users.username` are unique ACROSS tenants (ADR-051 Q-18),
 * but SCIM's duplicate check ran under the tenant hooks. An address another
 * tenant held passed it and the insert failed on the unique index. 2026-09-24
 * hid that behind a generic 500 — which an IdP retries forever, unlimited and
 * unaudited. ADR-075 gives SCIM the A-128 rule tenant administrators already
 * have: ONE 409 whoever holds the address (the check is global), a budget per
 * API key, and an audit row per conflict in the key's tenant.
 *
 * Through the REAL chain: scim.route → scim.controller → scim.service →
 * user.service#assertIdentityFree → the REAL models barrel (the global tenant
 * hooks, the User defaultScope) on an UNCONNECTED PostgreSQL-dialect Sequelize
 * whose `query` plays a two-tenant users table from the SQL it is given: a
 * SELECT that carries `"tenant_id" = '…'` sees only that tenant's rows, as
 * PostgreSQL would. Real rateLimiter.redis.service (in-process store),
 * audit.service and the audit_logs schema through the auditLedger fixture.
 * Stubbed: `auth` (it sets the API-key principal and the tenant context as
 * tryApiKeyAuth does), the INSERT and the instance UPDATE (which enforce the
 * GLOBAL unique constraint as the index does).
 *
 * What this cannot prove: that PostgreSQL raises 23505 (it does, per migration
 * 0063's indexes) — the SQL shape is asserted instead.
 */

const { createLedger } = require("../fixtures/auditLedger");

const TENANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const KEY_A = "a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a0a0";
const OTHER_KEY_A = "a3a3a3a3-a3a3-4a3a-8a3a-a3a3a3a3a3a3";
const SUPER_ADMIN = "99999999-9999-4999-8999-999999999999";
const USER_A = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";

const mockDb = { rows: [], sql: [], principal: null, ledger: null, failNextInsertWith: null };

jest.mock("../../config", () => {
  const { Sequelize } = jest.requireActual("sequelize");
  const db = new Sequelize({ dialect: "postgres", logging: false });
  // A users table that answers a SELECT from its SQL.
  db.query = async (sql, options = {}) => {
    const text = String(sql);
    mockDb.sql.push(text);
    if (!/^SELECT /i.test(text) || !/FROM "users"/.test(text) || !options.model) {
      return options.plain ? null : [];
    }
    const tenant = (text.match(/"tenant_id" = '([0-9a-f-]{36})'/) || [])[1];
    const showsDeleted = !/"is_deleted" = false/.test(text);
    const like = text.match(/"(email|username)" ILIKE '((?:[^']|'')*)'/);
    const id = (text.match(/"id" = '([0-9a-f-]{36})'/) || [])[1];
    const unescape = (pattern) => pattern.replace(/''/g, "'").replace(/\\(.)/g, "$1").toLowerCase();
    const found = mockDb.rows.filter(
      (row) =>
        (!tenant || row.tenantId === tenant) &&
        (showsDeleted || !row.isDeleted) &&
        (!like || String(row[like[1]]).toLowerCase() === unescape(like[2])) &&
        (!id || row.id === id),
    );
    const built = options.model.bulkBuild(found.map((row) => ({ ...row })), { raw: true, isNewRecord: false });
    return options.plain ? built[0] || null : built;
  };
  db.transaction = (...args) => mockDb.ledger.transaction(...args);
  return { db };
});

jest.mock("../../middlewares/auth.middleware", () => {
  const actual = jest.requireActual("../../middlewares/auth.middleware");
  const { tenantStorage } = jest.requireActual("../../middlewares/tenantContext.middleware");
  return {
    ...actual,
    auth: (req, res, next) => {
      req.user = mockDb.principal;
      tenantStorage.run(
        { tenantId: mockDb.principal.tenantId, isSuperAdmin: !mockDb.principal.isApiKey, isSystemTask: false },
        next,
      );
    },
  };
});

jest.mock("../../utils/password.util", () => ({
  hashPassword: jest.fn().mockResolvedValue("hashed:mock"),
}));

const { UniqueConstraintError, ConnectionError } = require("sequelize");
const models = require("../../models");
const { logger } = require("../../middlewares/activityLog.middleware");
const { clearMemoryStore } = require("../../services/rateLimiter.redis.service");
const { getAuthConfig } = require("../../constants/rateLimitConstants");
const scimRouter = require("../../routes/api/scim.route");

const BUDGET = getAuthConfig("scimIdentityConflict").maxAttempts;

const apiKey = (id, tenantId) => ({
  id,
  tenantId,
  isApiKey: true,
  apiKeyScopes: ["scim:write"],
  role: { id: null, name: "API_KEY" },
});
const superAdmin = { id: SUPER_ADMIN, tenantId: TENANT_A, isApiKey: false, role: { name: "SUPERADMIN" } };

const uniqueViolation = (field, value) =>
  new UniqueConstraintError({
    message: "Validation error",
    fields: { [field]: value },
    parent: { code: "23505", constraint: `users_${field}_lower_unique` },
  });

/** The unique index as migration 0063 declares it: GLOBAL, case-insensitive, deleted rows included. */
const clash = (values, exceptId) =>
  mockDb.rows.find(
    (row) =>
      row.id !== exceptId &&
      ["email", "username"].some(
        (field) => values[field] && String(row[field]).toLowerCase() === String(values[field]).toLowerCase(),
      ),
  );

// Express's own router.handle with a minimal req/res pair; `text` is the
// serialized body, so "byte-identical" is asserted on what goes on the wire.
const request = (principal, method, url, body) =>
  new Promise((resolve) => {
    mockDb.principal = principal;
    const res = {
      statusCode: 200,
      headersSent: false,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.headersSent = true;
        resolve({ status: this.statusCode, body: payload, text: JSON.stringify(payload) });
        return this;
      },
      setHeader() {
        return this;
      },
    };
    const req = {
      method,
      url,
      originalUrl: `/api/v1/scim/v2${url}`,
      body,
      query: {},
      params: {},
      headers: { "user-agent": "okta-scim/1.0" },
      ip: "198.51.100.7",
      get: () => undefined,
    };
    scimRouter.handle(req, res, (err) => resolve({ status: err ? err.status || 500 : 404, body: null, text: "" }));
  });

const provision = (principal, email) =>
  request(principal, "POST", "/Users", { userName: email, name: { givenName: "Ada", familyName: "Lovelace" } });

const rename = (principal, userId, email) =>
  request(principal, "PATCH", `/Users/${userId}`, {
    schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"],
    Operations: [{ op: "replace", path: "userName", value: email }],
  });

const conflictRows = () =>
  mockDb.ledger.auditRows().filter((row) => row.changes && row.changes.operation === "IDENTITY_CONFLICT");

/** The identity checks' SELECTs (the ILIKE ones) issued so far. */
const identitySelects = () => mockDb.sql.filter((sql) => /FROM "users"/.test(sql) && /ILIKE/.test(sql));

let warn;

beforeEach(() => {
  mockDb.ledger = createLedger();
  mockDb.sql = [];
  mockDb.failNextInsertWith = null;
  clearMemoryStore();
  mockDb.rows = [
    { id: "b0000000-0000-4000-8000-000000000001", tenantId: TENANT_B, email: "clinician@hospital-b.example.com", username: "clinician@hospital-b.example.com", isDeleted: false },
    { id: "b0000000-0000-4000-8000-000000000002", tenantId: TENANT_B, email: "left@hospital-b.example.com", username: "left@hospital-b.example.com", isDeleted: true },
    { id: USER_A, tenantId: TENANT_A, email: "own@hospital-a.example.com", username: "own@hospital-a.example.com", firstName: "Own", lastName: "User", isActive: true, status: "ACTIVE", isDeleted: false },
  ];
  jest.spyOn(models.Users, "create").mockImplementation(async (values) => {
    if (mockDb.failNextInsertWith) {
      const failure = mockDb.failNextInsertWith;
      mockDb.failNextInsertWith = null;
      throw failure;
    }
    if (clash(values)) {
      throw uniqueViolation("email", values.email);
    }
    const row = { id: `a0000000-0000-4000-8000-00000000000${mockDb.rows.length}`, ...values, isDeleted: false };
    mockDb.rows.push(row);
    return models.Users.build(row, { isNewRecord: false });
  });
  jest.spyOn(models.Users.prototype, "update").mockImplementation(async function update(values) {
    if (clash(values, this.id)) {
      throw uniqueViolation("email", values.email);
    }
    Object.assign(mockDb.rows.find((row) => row.id === this.id), values);
    this.set(values);
    return this;
  });
  jest.spyOn(models.AuditLog, "create").mockImplementation((...args) => mockDb.ledger.AuditLog.create(...args));
  warn = jest.spyOn(logger, "warn").mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

describe("A-37 — one honest 409, whichever tenant holds the address", () => {
  it("two tenants: tenant A's key creating an address tenant B holds gets a response byte-identical to an address tenant A holds", async () => {
    const crossTenant = await provision(apiKey(KEY_A, TENANT_A), "clinician@hospital-b.example.com");
    const ownTenant = await provision(apiKey(KEY_A, TENANT_A), "own@hospital-a.example.com");

    expect(crossTenant.status).toBe(409);
    expect(crossTenant.text).toBe(ownTenant.text);
    expect(crossTenant.body.message).toBe("User already exists in the system");
    expect(crossTenant.text).not.toMatch(/hospital-b|users_email|constraint|tenant/i);
  });

  it("the check is global: its SELECT carries no tenant predicate and does not hide deleted accounts", async () => {
    await provision(apiKey(KEY_A, TENANT_A), "nobody@hospital-a.example.com");

    const selects = identitySelects();
    expect(selects.length).toBeGreaterThanOrEqual(2); // email, then username
    for (const sql of selects) {
      expect(sql).not.toMatch(/tenant_id/);
      expect(sql).not.toMatch(/"is_deleted" = false/);
      expect(sql).not.toMatch(/deleted_at/);
    }
  });

  it("an address a SOFT-DELETED account in another tenant holds answers the same 409 (the index still holds it)", async () => {
    const deleted = await provision(apiKey(KEY_A, TENANT_A), "left@hospital-b.example.com");
    const own = await provision(apiKey(KEY_A, TENANT_A), "own@hospital-a.example.com");

    expect(deleted.status).toBe(409);
    expect(deleted.text).toBe(own.text);
  });

  it("the comparison ignores case, as the index does", async () => {
    const res = await provision(apiKey(KEY_A, TENANT_A), "Clinician@Hospital-B.example.com");
    expect(res.status).toBe(409);
    expect(models.Users.create).not.toHaveBeenCalled();
  });

  it("a fresh address is provisioned (201), and is neither counted nor audited", async () => {
    const res = await provision(apiKey(KEY_A, TENANT_A), "new@hospital-a.example.com");

    expect(res.status).toBe(201);
    expect(res.body.data.userName).toBe("new@hospital-a.example.com");
    expect(conflictRows()).toEqual([]);
  });
});

describe("A-37 — each conflict is audited in the key's tenant", () => {
  it("one row, actor system:scim, naming the key and the field — never the address or whose it was", async () => {
    await provision(apiKey(KEY_A, TENANT_A), "clinician@hospital-b.example.com");

    const rows = conflictRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tenantId: TENANT_A,
      userId: null,
      actorType: "system",
      actorName: "system:scim",
      action: "CREATE",
      resourceType: "User",
      resourceId: null,
      changes: { operation: "IDENTITY_CONFLICT", outcome: "refused", field: "userName", apiKeyId: KEY_A },
      ipAddress: "198.51.100.7",
      userAgent: "okta-scim/1.0",
    });
    expect(JSON.stringify(rows)).not.toMatch(/clinician|hospital-b|bbbbbbbb/);
    expect(mockDb.ledger.auditRows().filter((row) => row.tenantId === TENANT_B)).toEqual([]);
  });

  it("the log names the key and the tenant, not the address", async () => {
    await provision(apiKey(KEY_A, TENANT_A), "clinician@hospital-b.example.com");

    expect(warn).toHaveBeenCalledWith(
      "scim: identity conflict refused (A-37)",
      expect.objectContaining({ tenantId: TENANT_A, apiKeyId: KEY_A, action: "CREATE" }),
    );
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/clinician@hospital-b/);
  });

  it("a create that races past the check and hits the index gets the same 409, and is audited", async () => {
    // The check sees nothing; the insert then meets a row committed meanwhile.
    const racer = { id: "b0000000-0000-4000-8000-000000000009", tenantId: TENANT_B, email: "late@hospital-b.example.com", username: "late@hospital-b.example.com", isDeleted: false };
    models.Users.create.mockImplementationOnce(async () => {
      mockDb.rows.push(racer);
      throw uniqueViolation("email", racer.email);
    });

    const raced = await provision(apiKey(KEY_A, TENANT_A), "late@hospital-b.example.com");
    const own = await provision(apiKey(KEY_A, TENANT_A), "own@hospital-a.example.com");

    // Same status and message; outside production the envelope also carries
    // the stack (`details`), which differs by call site and is stripped in production.
    expect(raced.status).toBe(own.status);
    expect(raced.body.message).toBe(own.body.message);
    expect(conflictRows()).toHaveLength(2);
  });

  it("any other insert failure is still the one generic 500, logged without the address, and not counted", async () => {
    mockDb.failNextInsertWith = new ConnectionError(new Error("Connection terminated unexpectedly"));

    const res = await provision(apiKey(KEY_A, TENANT_A), "nobody@hospital-a.example.com");

    expect(res.status).toBe(500);
    expect(res.body.message).toBe("The user could not be provisioned");
    expect(conflictRows()).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      "scim: user provisioning failed",
      expect.objectContaining({ tenantId: TENANT_A, reason: "insert-error", errorName: "SequelizeConnectionError" }),
    );
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/nobody@hospital-a/);
  });

  it("a race refused by migration 0063's expression index (reported by constraint name only) is the same 409", async () => {
    // PostgreSQL reports `Key (lower(username::text))=(…)`; Sequelize parses no plain field from it.
    mockDb.failNextInsertWith = new UniqueConstraintError({
      message: "Validation error",
      fields: {},
      parent: { code: "23505", constraint: "users_username_lower_unique" },
    });

    const res = await provision(apiKey(KEY_A, TENANT_A), "nobody@hospital-a.example.com");

    expect(res.status).toBe(409);
    expect(conflictRows()).toHaveLength(1);
  });

  it("a failure of the identity lookup itself propagates (500) and is not counted as a conflict", async () => {
    jest.spyOn(models.Users, "findOne").mockRejectedValueOnce(new Error("connection lost"));

    const res = await provision(apiKey(KEY_A, TENANT_A), "nobody@hospital-a.example.com");

    expect(res.status).toBe(500);
    expect(conflictRows()).toEqual([]);
    expect(models.Users.create).not.toHaveBeenCalled();
  });

  it("a unique violation on another column is not an identity conflict: generic 500, not counted", async () => {
    mockDb.failNextInsertWith = new UniqueConstraintError({ message: "Validation error", fields: { id: "x" } });

    const res = await provision(apiKey(KEY_A, TENANT_A), "nobody@hospital-a.example.com");

    expect(res.status).toBe(500);
    expect(conflictRows()).toEqual([]);
  });
});

describe("A-37 — the conflict budget is per API key", () => {
  it(`after ${BUDGET} conflicts the key is refused with 429 BEFORE any lookup — even for a fresh address`, async () => {
    for (let i = 0; i < BUDGET; i += 1) {
      expect((await provision(apiKey(KEY_A, TENANT_A), "clinician@hospital-b.example.com")).status).toBe(409);
    }
    mockDb.sql = [];

    const res = await provision(apiKey(KEY_A, TENANT_A), "fresh@hospital-a.example.com");

    expect(res.status).toBe(429);
    expect(res.body.message).toMatch(/paused for an hour/);
    expect(identitySelects()).toEqual([]);
    expect(models.Users.create).not.toHaveBeenCalled();
    expect(conflictRows()).toHaveLength(BUDGET);
  });

  it("another key of the same tenant has its own budget", async () => {
    for (let i = 0; i < BUDGET; i += 1) {
      await provision(apiKey(KEY_A, TENANT_A), "clinician@hospital-b.example.com");
    }

    const res = await provision(apiKey(OTHER_KEY_A, TENANT_A), "fresh@hospital-a.example.com");
    expect(res.status).toBe(201);
  });

  it("a super admin's JWT is answered the same 409 but is neither counted nor audited", async () => {
    for (let i = 0; i < BUDGET + 1; i += 1) {
      expect((await provision(superAdmin, "clinician@hospital-b.example.com")).status).toBe(409);
    }
    expect(conflictRows()).toEqual([]);
  });
});

describe("A-37 — a userName change is the same probe", () => {
  it("renaming tenant A's user to an address tenant B holds is byte-identical to renaming it to one tenant A holds", async () => {
    mockDb.rows.push({ id: "a0000000-0000-4000-8000-0000000000aa", tenantId: TENANT_A, email: "second@hospital-a.example.com", username: "second@hospital-a.example.com", firstName: "S", lastName: "U", isActive: true, status: "ACTIVE", isDeleted: false });

    const crossTenant = await rename(apiKey(KEY_A, TENANT_A), USER_A, "clinician@hospital-b.example.com");
    const ownTenant = await rename(apiKey(KEY_A, TENANT_A), USER_A, "second@hospital-a.example.com");

    expect(crossTenant.status).toBe(409);
    expect(crossTenant.text).toBe(ownTenant.text);
    expect(mockDb.rows.find((row) => row.id === USER_A).email).toBe("own@hospital-a.example.com");
    const rows = conflictRows();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ action: "UPDATE", resourceId: USER_A, actorName: "system:scim", tenantId: TENANT_A });
  });

  it("keeping the user's own address (in any case) is not a change: no lookup, no conflict", async () => {
    const res = await rename(apiKey(KEY_A, TENANT_A), USER_A, "OWN@hospital-a.example.com");

    expect(res.status).toBe(200);
    expect(identitySelects()).toEqual([]);
    expect(conflictRows()).toEqual([]);
  });

  it("a rename that races past the check and hits the index gets the same 409, audited", async () => {
    models.Users.prototype.update.mockImplementationOnce(async () => {
      throw uniqueViolation("email", "late@hospital-b.example.com");
    });

    const res = await rename(apiKey(KEY_A, TENANT_A), USER_A, "late@hospital-b.example.com");

    expect(res.status).toBe(409);
    expect(res.body.message).toBe("User already exists in the system");
    expect(conflictRows()).toHaveLength(1);
  });

  it("any other update failure propagates unchanged", async () => {
    models.Users.prototype.update.mockImplementationOnce(async () => {
      throw new ConnectionError(new Error("Connection terminated unexpectedly"));
    });

    const res = await rename(apiKey(KEY_A, TENANT_A), USER_A, "free@hospital-a.example.com");

    expect(res.status).toBe(500);
    expect(conflictRows()).toEqual([]);
  });

  it("a rename to a free address succeeds", async () => {
    const res = await rename(apiKey(KEY_A, TENANT_A), USER_A, "Renamed@hospital-a.example.com");

    expect(res.status).toBe(200);
    expect(mockDb.rows.find((row) => row.id === USER_A).email).toBe("renamed@hospital-a.example.com");
  });

  it("tenant A's key cannot rename tenant B's user: 404, as for an id that does not exist", async () => {
    const other = await rename(apiKey(KEY_A, TENANT_A), "b0000000-0000-4000-8000-000000000001", "x@hospital-a.example.com");
    const missing = await rename(apiKey(KEY_A, TENANT_A), "a9999999-0000-4000-8000-000000000001", "x@hospital-a.example.com");

    expect(other.status).toBe(404);
    expect(other.text).toBe(missing.text);
  });
});
