/**
 * Q-08 (ADR-084) — GET /sessions/mine and POST /sessions/mine/:id/revoke.
 *
 * ADR-084 decided against a concurrent-session cap and against IP/user-agent
 * binding; the control in their place is that a user sees every live session
 * of their own and can end any one of them. Through the REAL chain —
 * session.route (auth stubbed, denyApiKey, validateUuid) →
 * ownSessions.controller → ownSessions.service — over principals from the
 * two-tenant fixture. The Sessions model double applies the WHERE the service
 * builds (user, live flags, expiry, id), as the database would, so a predicate
 * the service forgot is not applied for it. The transaction double applies
 * writes at once and undoes them on rollback.
 */

const mockState = { principal: null, sessionId: null, rows: [], audit: [], failAudit: null };

jest.mock("../../middlewares/auth.middleware", () => {
  const actual = jest.requireActual("../../middlewares/auth.middleware");
  return {
    ...actual,
    auth: (req, res, next) => {
      req.user = mockState.principal;
      req.sessionId = mockState.sessionId;
      next();
    },
  };
});
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const mockMatches = (row, where) => {
  const { Op } = jest.requireActual("sequelize");
  return Object.entries(where).every(([key, expected]) => {
    if (expected && typeof expected === "object" && expected[Op.gt] !== undefined) {
      return row[key] > expected[Op.gt];
    }
    return row[key] === expected;
  });
};

jest.mock("../../models", () => ({
  Sessions: {
    findAll: jest.fn(async ({ where, limit, skipTenantScope }) => {
      expect(skipTenantScope).toBe(true);
      return mockState.rows.filter((r) => mockMatches(r, where)).slice(0, limit);
    }),
    findOne: jest.fn(async ({ where }) => mockState.rows.find((r) => mockMatches(r, where)) || null),
  },
}));

jest.mock("../../config", () => ({
  db: {
    transaction: async (work) => {
      const tx = { undo: [] };
      try {
        return await work(tx);
      } catch (error) {
        for (const [row, prior] of tx.undo.reverse()) {
          Object.assign(row, prior);
        }
        throw error;
      }
    },
  },
}));

jest.mock("../../services/audit.service", () => ({
  logAction: jest.fn(async (entry, options) => {
    if (mockState.failAudit) {
      throw mockState.failAudit;
    }
    mockState.audit.push({ entry, transaction: options.transaction });
    return {};
  }),
}));

const { createTwoTenants } = require("../fixtures/twoTenants");
const { PLATFORM_TENANT_ID } = require("../../constants/platformTenant");
const router = require("../../routes/api/session.route");

const http = (method, url) =>
  new Promise((resolve) => {
    const res = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        resolve({ status: this.statusCode, body: payload });
        return this;
      },
      send(payload) {
        return this.json(payload);
      },
      setHeader() {
        return this;
      },
    };
    const req = {
      method: method.toUpperCase(),
      url,
      originalUrl: "/api/v1/sessions" + url,
      body: {},
      query: {},
      params: {},
      headers: { "user-agent": "jest" },
      ip: "127.0.0.1",
      get: () => undefined,
    };
    router.handle(req, res, (err) =>
      resolve({ status: err ? err.status || 500 : 404, body: { message: err ? err.message : "no route" } }),
    );
  });

const sid = (n) => `55555555-5555-4555-8555-${String(n).padStart(12, "0")}`;
const FUTURE = new Date(Date.now() + 86400000);
const PAST = new Date(Date.now() - 1000);

const session = (n, user, overrides = {}) => {
  const row = {
    id: sid(n),
    user_id: user.id,
    tenant_id: user.tenantId,
    ip_address: `198.51.100.${n}`,
    user_agent: `Browser ${n}`,
    device: null,
    auth_method: null,
    impersonator_id: null,
    // A-339: a built row carries the ATTRIBUTE `createdAt` (column created_at).
    createdAt: new Date(2026, 8, n),
    last_activity_at: null,
    expired_at: FUTURE,
    is_revoked: false,
    is_active: true,
    ...overrides,
  };
  row.update = async (values, options) => {
    const prior = {};
    for (const key of Object.keys(values)) {
      prior[key] = row[key];
    }
    options.transaction.undo.push([row, prior]);
    Object.assign(row, values);
    return row;
  };
  return row;
};

describe("Q-08 (ADR-084): a user's own sessions — listed, and ended one at a time", () => {
  let fx;
  let alice; // tenant A
  let bob; // tenant B

  beforeEach(() => {
    jest.clearAllMocks();
    fx = createTwoTenants();
    alice = fx.principal(fx.tenantA, "TECHNICIAN");
    bob = fx.principal(fx.tenantB, "TECHNICIAN");
    mockState.principal = alice;
    mockState.sessionId = sid(1);
    mockState.audit = [];
    mockState.failAudit = null;
    mockState.rows = [
      session(1, alice),
      session(2, alice, { auth_method: "oidc", impersonator_id: "99999999-9999-4999-8999-999999999999" }),
      session(3, alice, { is_revoked: true, is_active: false }),
      session(4, alice, { expired_at: PAST }),
      session(5, bob),
    ];
  });

  describe("GET /mine", () => {
    it("lists only the caller's LIVE sessions, marks this one, and shows what was recorded at sign-in", async () => {
      const res = await http("get", "/mine");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.map((s) => s.id).sort()).toEqual([sid(1), sid(2)]);
      const [one] = res.body.data.filter((s) => s.id === sid(1));
      expect(one).toMatchObject({
        current: true,
        ipAddress: "198.51.100.1",
        userAgent: "Browser 1",
        signInMethod: "password",
        impersonated: false,
      });
      const [two] = res.body.data.filter((s) => s.id === sid(2));
      expect(two).toMatchObject({ current: false, signInMethod: "oidc", impersonated: true });
      // The operator's identity is not disclosed.
      expect(JSON.stringify(res.body)).not.toContain("99999999-9999-4999-8999-999999999999");
    });

    it("shows nothing it did not record, and marks no session current when the request names none", async () => {
      mockState.sessionId = null;
      mockState.rows[0].ip_address = null;
      mockState.rows[0].user_agent = null;

      const res = await http("get", "/mine");

      const [one] = res.body.data.filter((s) => s.id === sid(1));
      expect(one).toMatchObject({ current: false, ipAddress: null, userAgent: null, device: null });
    });

    it("is refused to an API key", async () => {
      mockState.principal = { ...alice, isApiKey: true };

      const res = await http("get", "/mine");

      expect(res.status).toBe(403);
    });
  });

  describe("POST /mine/:id/revoke", () => {
    it("ends another of the caller's sessions, with its audit row in the same transaction", async () => {
      const res = await http("post", `/mine/${sid(2)}/revoke`);

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ id: sid(2), current: false });
      expect(mockState.rows[1]).toMatchObject({ is_revoked: true, is_active: false, revoked_reason: "USER_REVOKED" });
      expect(mockState.audit).toHaveLength(1);
      expect(mockState.audit[0].transaction).toBeDefined();
      expect(mockState.audit[0].entry).toMatchObject({
        tenantId: fx.tenantA.id,
        userId: alice.id,
        action: "UPDATE",
        resourceType: "Session",
        resourceId: sid(2),
        changes: { operation: "REVOKE_OWN_SESSION", current: false, reason: "USER_REVOKED" },
        ipAddress: "127.0.0.1",
        userAgent: "jest",
      });
    });

    it("can end the session making the request", async () => {
      const res = await http("post", `/mine/${sid(1)}/revoke`);

      expect(res.status).toBe(200);
      expect(res.body.data.current).toBe(true);
      expect(res.body.message).toBe("This session has been signed out");
    });

    it("another tenant's user's session answers 404 — exactly as one that does not exist — and stays live", async () => {
      const other = await http("post", `/mine/${sid(5)}/revoke`);
      const missing = await http("post", `/mine/${sid(77)}/revoke`);

      expect(other.status).toBe(404);
      expect(other).toEqual(missing);
      expect(mockState.rows[4].is_revoked).toBe(false);
      expect(mockState.audit).toEqual([]);
    });

    it("an already-ended or expired session of the caller's own answers 404 too", async () => {
      expect((await http("post", `/mine/${sid(3)}/revoke`)).status).toBe(404);
      expect((await http("post", `/mine/${sid(4)}/revoke`)).status).toBe(404);
    });

    it("if the audit row cannot be written, the session stays live", async () => {
      mockState.failAudit = new Error("audit insert failed");

      const res = await http("post", `/mine/${sid(2)}/revoke`);

      expect(res.status).toBe(500);
      expect(mockState.rows[1]).toMatchObject({ is_revoked: false, is_active: true });
    });

    it("a tenant-less principal's row goes in PLATFORM", async () => {
      const operator = { ...alice, tenantId: null };
      mockState.principal = operator;
      mockState.rows[1].tenant_id = null;

      const res = await http("post", `/mine/${sid(2)}/revoke`);

      expect(res.status).toBe(200);
      expect(mockState.audit[0].entry.tenantId).toBe(PLATFORM_TENANT_ID);
    });

    it("a tenant-less principal with a tenant-bound session records it in that tenant", async () => {
      mockState.principal = { ...alice, tenantId: null };
      mockState.sessionId = null;

      const res = await http("post", `/mine/${sid(2)}/revoke`);

      expect(res.status).toBe(200);
      expect(mockState.audit[0].entry.tenantId).toBe(fx.tenantA.id);
    });

    it("called with no actor, records no address or browser", async () => {
      const service = require("../../services/ownSessions.service");

      const result = await service.revokeOwnSession(alice, sid(2), null);

      expect(result.status).toBe(200);
      expect(mockState.audit[0].entry).toMatchObject({ ipAddress: null, userAgent: null });
    });

    it("answers 400 for a malformed id", async () => {
      expect((await http("post", "/mine/not-a-uuid/revoke")).status).toBe(400);
    });
  });
});
