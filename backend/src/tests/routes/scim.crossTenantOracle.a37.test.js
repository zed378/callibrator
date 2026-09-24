/**
 * A-37 — SCIM user creation was a cross-tenant existence oracle.
 *
 * `users.email` / `users.username` are unique ACROSS tenants (user.model.js),
 * but the duplicate check in scim.service#createUser is narrowed to the
 * caller's tenant by the global tenant hooks. An address held by another
 * tenant therefore passed the check and was rejected by the database, and that
 * rejection surfaced as its own response — a 500 carrying Sequelize's
 * "Validation error" — distinguishable from every other failure.
 *
 * Through the REAL chain: scim.route → scim.controller → scim.service. Only
 * `auth` (to set the API-key principal) and the models are stubbed. The
 * `Users` double is a tiny users table that behaves as the database does
 * today: `findOne` is tenant-scoped (the global hooks), `create` enforces the
 * GLOBAL unique constraint on email/username and throws the same
 * `UniqueConstraintError` Sequelize throws on a PostgreSQL 23505.
 *
 * What this cannot prove: that PostgreSQL raises 23505 there (it does, per the
 * constraint user.model.js declares), or that the constraint is on the
 * deployed database (D-06's psql query).
 */

const { ConnectionError } = require("sequelize");

const TENANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const mockDb = { rows: [], tenantId: null, failNextInsertWith: null };

jest.mock("../../middlewares/auth.middleware", () => {
  const actual = jest.requireActual("../../middlewares/auth.middleware");
  return {
    ...actual,
    auth: (req, res, next) => {
      req.user = {
        id: "api-key-1",
        isApiKey: true,
        apiKeyScopes: ["scim:write"],
        tenantId: mockDb.tenantId,
        role: { name: "USER" },
      };
      next();
    },
  };
});

jest.mock("../../models", () => {
  const { UniqueConstraintError: UniqueError } = require("sequelize");
  return {
    Users: {
      // The global tenant hooks add the caller's tenant to every find.
      findOne: jest.fn(async ({ where }) =>
        mockDb.rows.find(
          (row) => row.tenantId === mockDb.tenantId && row.email === where.email,
        ) || null,
      ),
      // The database enforces the constraint as declared: GLOBAL, not per tenant.
      create: jest.fn(async (values) => {
        if (mockDb.failNextInsertWith) {
          const failure = mockDb.failNextInsertWith;
          mockDb.failNextInsertWith = null;
          throw failure;
        }
        const clash = mockDb.rows.find(
          (row) => row.email === values.email || row.username === values.username,
        );
        if (clash) {
          throw new UniqueError({
            message: "Validation error",
            fields: { email: values.email },
            parent: { code: "23505", constraint: "users_email_key" },
          });
        }
        const row = {
          id: `user-${mockDb.rows.length + 1}`,
          ...values,
          createdAt: new Date("2026-09-24T00:00:00Z"),
          updatedAt: new Date("2026-09-24T00:00:00Z"),
        };
        mockDb.rows.push(row);
        return row;
      }),
    },
    Role: { findOne: jest.fn() },
  };
});

jest.mock("../../utils/password.util", () => ({
  hashPassword: jest.fn().mockResolvedValue("hashed:mock"),
}));

const { logger } = require("../../middlewares/activityLog.middleware");
const scimRouter = require("../../routes/api/scim.route");

// Express's own router.handle with a minimal req/res pair (the harness of
// tenant.edit.a63.test.js — supertest is not a dependency here). `text` is
// the serialized body, so "byte-identical" is asserted on what goes on the wire.
const provision = (tenantId, email) =>
  new Promise((resolve) => {
    mockDb.tenantId = tenantId;
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
      method: "POST",
      url: "/Users",
      originalUrl: "/api/v1/scim/v2/Users",
      body: { userName: email, name: { givenName: "Ada", familyName: "Lovelace" } },
      query: {},
      params: {},
      headers: {},
      ip: "127.0.0.1",
      get: () => undefined,
    };
    // asyncHandler forwards the error after it has responded; the first
    // resolve wins, so the forwarded error is ignored as index.js's is.
    scimRouter.handle(req, res, (err) =>
      resolve({ status: err ? err.status || 500 : 404, body: null, text: "" }),
    );
  });

describe("A-37 — SCIM user creation does not disclose other tenants' users", () => {
  let warn;

  beforeEach(() => {
    mockDb.rows = [
      { id: "b-1", tenantId: TENANT_B, email: "clinician@hospital-b.example.com", username: "clinician@hospital-b.example.com" },
      { id: "a-1", tenantId: TENANT_A, email: "own@hospital-a.example.com", username: "own@hospital-a.example.com" },
    ];
    mockDb.failNextInsertWith = null;
    warn = jest.spyOn(logger, "warn").mockImplementation(() => {});
  });

  afterEach(() => warn.mockRestore());

  it("SCIM create for an email that exists in another tenant is indistinguishable from a fresh email whose insert fails for any other reason", async () => {
    // The oracle probe: tenant A's key tries an address tenant B holds.
    const crossTenant = await provision(TENANT_A, "clinician@hospital-b.example.com");

    // The generic case: an address nobody holds, whose insert fails anyway.
    mockDb.failNextInsertWith = new ConnectionError(new Error("Connection terminated unexpectedly"));
    const generic = await provision(TENANT_A, "nobody@hospital-a.example.com");

    expect(crossTenant.status).toBe(generic.status);
    expect(crossTenant.text).toBe(generic.text); // byte-identical body
    expect(crossTenant.body.message).toBe("The user could not be provisioned");
    expect(crossTenant.body).not.toHaveProperty("data.id");
  });

  it("the response to the cross-tenant collision names neither the address, the column nor the constraint", async () => {
    const res = await provision(TENANT_A, "clinician@hospital-b.example.com");

    expect(res.text).not.toMatch(/clinician@hospital-b\.example\.com/);
    expect(res.text).not.toMatch(/users_email_key|Validation error|unique|already exists/i);
  });

  it("the reason is logged — without the address — so an operator can still diagnose it", async () => {
    await provision(TENANT_A, "clinician@hospital-b.example.com");

    expect(warn).toHaveBeenCalledWith(
      "scim: user provisioning failed",
      expect.objectContaining({
        tenantId: TENANT_A,
        reason: "unique-violation",
        errorName: "SequelizeUniqueConstraintError",
        constraint: "users_email_key",
        fields: ["email"],
      }),
    );
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/clinician@hospital-b\.example\.com/);
  });

  it("a non-constraint insert failure is logged as such, with its message", async () => {
    mockDb.failNextInsertWith = new ConnectionError(new Error("Connection terminated unexpectedly"));
    await provision(TENANT_A, "nobody@hospital-a.example.com");

    expect(warn).toHaveBeenCalledWith(
      "scim: user provisioning failed",
      expect.objectContaining({ reason: "insert-error", errorName: "SequelizeConnectionError" }),
    );
  });

  it("a duplicate inside the caller's own tenant is still a 409 — the caller can list its own users, so it discloses nothing", async () => {
    const res = await provision(TENANT_A, "own@hospital-a.example.com");

    expect(res.status).toBe(409);
  });

  it("a fresh address is provisioned (201) — the fix does not turn every create into a failure", async () => {
    const res = await provision(TENANT_A, "new@hospital-a.example.com");

    expect(res.status).toBe(201);
    expect(res.body.data.userName).toBe("new@hospital-a.example.com");
  });
});
