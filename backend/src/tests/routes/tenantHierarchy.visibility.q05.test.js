/**
 * Q-05 (ADR-084) — a parent tenant never sees a child tenant's data.
 *
 * The hierarchy is structure, not access. These tests pin the decision from
 * three sides:
 *
 *  1. Through the REAL tenant-hierarchy router, over the two-tenant fixture
 *     with tenant A made the PARENT of tenant B: every read naming the other
 *     tenant answers 404 in both directions, and the answer is byte-for-byte
 *     the answer for an id that names no tenant at all (CLAUDE.md: not-yours
 *     and non-existent are indistinguishable). Being the parent changes
 *     nothing.
 *  2. The service no longer carries the helpers that encoded the opposite
 *     decision (getDataVisibilityScope's "subtree" and "all" scopes,
 *     buildTenantFilter, HIERARCHY_SCOPE), and no source file calls them.
 *  3. The request tenant context — what the global tenant hooks read — holds
 *     exactly one tenant and never consults the hierarchy.
 */

const fs = require("fs");
const path = require("path");

const mockFx = { current: null };
let currentUser = null;

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

// Tenant A is B's parent. The hierarchy rows are what the service would read;
// they are reached only for the caller's OWN tenant.
const mockHierarchyRows = () => [
  { tenantId: mockFx.current.tenantA.id, tenantCode: "HOSP-A", parentCode: null, path: "/hosp-a", depth: 0 },
  { tenantId: mockFx.current.tenantB.id, tenantCode: "HOSP-B", parentCode: "HOSP-A", path: "/hosp-a/hosp-b", depth: 1 },
];

jest.mock("../../models", () => ({
  TenantHierarchy: {
    findOne: jest.fn(async ({ where }) => {
      const row = mockHierarchyRows().find((r) => r.tenantId === where.tenantId);
      return row ? { ...row } : null;
    }),
    findAll: jest.fn(async () => []),
  },
  Tenant: {},
}));

jest.mock("../../config", () => ({
  db: {
    transaction: (...args) => mockFx.current.transaction(...args),
    Sequelize: { Op: { like: Symbol("like") } },
  },
}));

jest.mock("../../services/audit.service", () => ({
  logAction: jest.fn().mockResolvedValue({}),
}));
jest.mock("../../middlewares/activityLog.middleware", () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const { createTwoTenants } = require("../fixtures/twoTenants");
const router = require("../../routes/api/tenantHierarchy.route");
const hierarchyService = require("../../services/tenantHierarchy.service");

// Express's own router.handle with a minimal req/res pair (the harness of
// tenant.edit.a63.test.js — supertest is not a dependency here).
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
      originalUrl: "/api/v1/tenant-hierarchy" + url,
      body: {},
      query: {},
      params: {},
      headers: {},
      ip: "127.0.0.1",
      get: () => undefined,
    };
    router.handle(req, res, (err) =>
      resolve({ status: err ? err.status || 500 : 404, body: { message: err ? err.message : "no route" } }),
    );
  });

const NO_SUCH_TENANT = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const READS = ["children", "parent", "descendants", "ancestors"];

describe("Q-05 (ADR-084): the hierarchy grants no visibility across tenants", () => {
  let fx;

  beforeEach(() => {
    fx = createTwoTenants();
    mockFx.current = fx;
  });

  describe("tenant A is the PARENT of tenant B", () => {
    it.each(READS)(
      "the parent's administrator reading the child's /%s gets 404, exactly as for a tenant that does not exist",
      async (read) => {
        currentUser = fx.principal(fx.tenantA, "HEALTCARE_ADMIN");

        const child = await http("get", `/${fx.tenantB.id}/${read}`);
        const nobody = await http("get", `/${NO_SUCH_TENANT}/${read}`);

        expect(child.status).toBe(404);
        expect(child).toEqual(nobody);
      },
    );

    it.each(READS)("the child's administrator reading the parent's /%s gets 404 too", async (read) => {
      currentUser = fx.principal(fx.tenantB, "HEALTCARE_ADMIN");

      const parent = await http("get", `/${fx.tenantA.id}/${read}`);
      const nobody = await http("get", `/${NO_SUCH_TENANT}/${read}`);

      expect(parent.status).toBe(404);
      expect(parent).toEqual(nobody);
    });

    it("the parent can still read its own tenant's structure", async () => {
      currentUser = fx.principal(fx.tenantA, "HEALTCARE_ADMIN");

      const own = await http("get", `/${fx.tenantA.id}/descendants`);

      expect(own.status).toBe(200);
    });
  });

  describe("no code widens a tenant's reach through the hierarchy", () => {
    it("the service exports no visibility scope, tenant filter or scope constants", () => {
      expect(hierarchyService.getDataVisibilityScope).toBeUndefined();
      expect(hierarchyService.buildTenantFilter).toBeUndefined();
      expect(hierarchyService.HIERARCHY_SCOPE).toBeUndefined();
    });

    it("no source file calls a hierarchy visibility helper", () => {
      const root = path.resolve(__dirname, "../..");
      const offenders = [];
      const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            if (entry.name !== "tests") {
              walk(full);
            }
          } else if (entry.name.endsWith(".js") || entry.name.endsWith(".ts")) {
            const code = fs
              .readFileSync(full, "utf8")
              // comments may name the removed helpers; code may not
              .replace(/\/\*[\s\S]*?\*\//g, "")
              .replace(/\/\/.*$/gm, "");
            if (/getDataVisibilityScope|buildTenantFilter|HIERARCHY_SCOPE|scope:\s*["']subtree["']/.test(code)) {
              offenders.push(path.relative(root, full));
            }
          }
        }
      };
      walk(root);

      expect(offenders).toEqual([]);
    });

    it("the request tenant context never reads the hierarchy", () => {
      const source = fs.readFileSync(
        // P9-05a (ADR-087 Amendment 2): the module is TypeScript now; the same
        // assertions, on the same source.
        path.resolve(__dirname, "../../middlewares/tenantContext.middleware.ts"),
        "utf8",
      );

      expect(source).not.toMatch(/hierarch/i);
      expect(source).not.toMatch(/descendant|ancestor|parent_?code/i);
    });
  });
});
