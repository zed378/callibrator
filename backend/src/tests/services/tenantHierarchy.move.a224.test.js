/**
 * A-224 — moving a tenant in the hierarchy (PUT / DELETE /tenant-hierarchy/:tenantId/parent).
 *
 * The two controller handlers this replaces wrote the tenant and its hierarchy
 * row in two autocommits, wrote no audit row, accepted a parent inside the
 * tenant's own subtree (a cycle), left every descendant's materialised path at
 * the old position, and answered "already a root" with a 404.
 *
 * The store below is a small in-memory tree — tenants and tenant_hierarchies
 * rows — so the assertions are about the resulting TREE, not about which
 * mocked call was made.
 *
 *        hq                 other
 *        └── hq_001         (root, no row)
 *            └── hq_001_001
 */

const mockOp = { like: Symbol("Op.like") };
const mockState = { tenants: [], rows: [], audit: [], committed: false, failAudit: false };

/** A LIKE pattern with `\`-escapes, evaluated the way PostgreSQL would. */
const mockLike = (value, pattern) => {
  let re = "";
  for (let i = 0; i < pattern.length; i += 1) {
    const c = pattern[i];
    if (c === "\\") {
      i += 1;
      re += pattern[i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    } else if (c === "%") {
      re += ".*";
    } else if (c === "_") {
      re += ".";
    } else {
      re += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${re}$`).test(value);
};

const mockRow = (store, row) => {
  Object.defineProperty(row, "update", {
    enumerable: false,
    value: async (values) => Object.assign(row, values),
  });
  return row;
};

jest.mock("../../config", () => ({
  db: {
    Sequelize: { Op: mockOp, Transaction: { LOCK: { UPDATE: "UPDATE" } } },
    // Rollback semantics: a throw restores the snapshot taken at the start.
    transaction: async (cb) => {
      const snapshot = JSON.stringify({ tenants: mockState.tenants, rows: mockState.rows, audit: mockState.audit });
      try {
        const out = await cb("TX");
        mockState.committed = true;
        return out;
      } catch (err) {
        const back = JSON.parse(snapshot);
        mockState.tenants.splice(0, Infinity, ...back.tenants.map((r) => mockRow("tenants", r)));
        mockState.rows.splice(0, Infinity, ...back.rows.map((r) => mockRow("rows", r)));
        mockState.audit.splice(0, Infinity, ...back.audit);
        throw err;
      }
    },
  },
}));
jest.mock("../../services/audit.service", () => ({
  logAction: jest.fn(async (row, options) => {
    if (mockState.failAudit) {throw new Error("audit insert failed");}
    mockState.audit.push({ row, options });
  }),
}));
jest.mock("../../models", () => ({
  Tenant: {
    findByPk: jest.fn(async (id) => mockState.tenants.find((t) => t.id === id) || null),
  },
  TenantHierarchy: {
    findOne: jest.fn(async ({ where }) =>
      mockState.rows.find((r) => Object.entries(where).every(([k, v]) => r[k] === v)) || null,
    ),
    findAll: jest.fn(async ({ where }) => mockState.rows.filter((r) => mockLike(r.path, where.path[mockOp.like]))),
    create: jest.fn(async (values) => {
      const row = mockRow("rows", { id: `row-${values.tenantId}`, ...values });
      mockState.rows.push(row);
      return row;
    }),
  },
}));

const { PLATFORM_TENANT_ID } = require("../../constants/platformTenant");
const svc = require("../../services/tenantHierarchy.service");

const HQ = "00000000-0000-4000-8000-0000000000a1";
const CHILD = "00000000-0000-4000-8000-0000000000a2";
const GRANDCHILD = "00000000-0000-4000-8000-0000000000a3";
const OTHER = "00000000-0000-4000-8000-0000000000b1";
const ACTOR = { userId: "super-1", ipAddress: "10.0.0.9", userAgent: "jest" };

const tenant = (id, code, parentId, name = code) => mockRow("tenants", { id, code, parentId, name });
const hrow = (tenantId, tenantCode, parentCode, path, depth) =>
  mockRow("rows", { id: `row-${tenantId}`, tenantId, tenantCode, parentCode, path, depth });

beforeEach(() => {
  jest.clearAllMocks();
  mockState.committed = false;
  mockState.failAudit = false;
  mockState.audit = [];
  mockState.tenants = [
    tenant(HQ, "HQ", null),
    tenant(CHILD, "HQ_001", HQ),
    tenant(GRANDCHILD, "HQ_001_001", CHILD),
    tenant(OTHER, "OTHER", null, "Other hospital"),
  ];
  mockState.rows = [
    hrow(HQ, "HQ", null, "/hq", 0),
    hrow(CHILD, "HQ_001", "HQ", "/hq/hq_001", 1),
    hrow(GRANDCHILD, "HQ_001_001", "HQ_001", "/hq/hq_001/hq_001_001", 2),
  ];
});

const rowOf = (id) => mockState.rows.find((r) => r.tenantId === id);
const tenantOf = (id) => mockState.tenants.find((t) => t.id === id);

describe("A-224 — updateTenantParent", () => {
  it("moves the tenant AND its whole subtree: every descendant's path and depth follow", async () => {
    const res = await svc.updateTenantParent(CHILD, OTHER, ACTOR);

    expect(res).toEqual({ tenantId: CHILD, parentId: OTHER, path: "/other/hq_001", depth: 1, descendantsMoved: 1 });
    expect(tenantOf(CHILD).parentId).toBe(OTHER);
    expect(rowOf(CHILD)).toMatchObject({ parentCode: "OTHER", path: "/other/hq_001", depth: 1 });
    // Before A-224 the grandchild kept /hq/hq_001/hq_001_001 and vanished from both trees.
    expect(rowOf(GRANDCHILD)).toMatchObject({ path: "/other/hq_001/hq_001_001", depth: 2 });
  });

  it("writes ONE audit row, under the platform tenant, with before and after", async () => {
    await svc.updateTenantParent(CHILD, OTHER, ACTOR);

    expect(mockState.audit).toEqual([
      {
        row: {
          tenantId: PLATFORM_TENANT_ID,
          userId: "super-1",
          action: "UPDATE",
          resourceType: "Tenant",
          resourceId: CHILD,
          changes: {
            operation: "MOVE_TENANT",
            before: { parentId: HQ, path: "/hq/hq_001", depth: 1 },
            after: { parentId: OTHER, path: "/other/hq_001", depth: 1 },
            descendantsMoved: 1,
          },
          ipAddress: "10.0.0.9",
          userAgent: "jest",
        },
        options: { transaction: "TX" },
      },
    ]);
  });

  it("a failed audit insert rolls the whole move back", async () => {
    mockState.failAudit = true;

    await expect(svc.updateTenantParent(CHILD, OTHER, ACTOR)).rejects.toThrow("audit insert failed");

    expect(tenantOf(CHILD).parentId).toBe(HQ);
    expect(rowOf(CHILD).path).toBe("/hq/hq_001");
    expect(rowOf(GRANDCHILD).path).toBe("/hq/hq_001/hq_001_001");
  });

  it("refuses a parent inside the tenant's own subtree (409) — the cycle", async () => {
    const err = await svc.updateTenantParent(HQ, GRANDCHILD, ACTOR).catch((e) => e);

    expect(err).toMatchObject({
      status: 409,
      message: '"HQ_001_001" is inside this tenant\'s own subtree: moving the tenant under it would make a cycle',
    });
    expect(tenantOf(HQ).parentId).toBeNull();
    expect(mockState.audit).toEqual([]);
  });

  it("refuses the tenant as its own parent (409)", async () => {
    await expect(svc.updateTenantParent(CHILD, CHILD, ACTOR)).rejects.toMatchObject({
      status: 409,
      message: "A tenant cannot be its own parent",
    });
  });

  it("refuses a move to the parent it already has (409)", async () => {
    await expect(svc.updateTenantParent(CHILD, HQ, ACTOR)).rejects.toMatchObject({
      status: 409,
      message: "This tenant is already under that parent",
    });
  });

  it("answers 400 for a missing or malformed newParentId", async () => {
    await expect(svc.updateTenantParent(CHILD, undefined, ACTOR)).rejects.toMatchObject({ status: 400 });
    await expect(svc.updateTenantParent(CHILD, "not-a-uuid", ACTOR)).rejects.toMatchObject({ status: 400 });
    await expect(svc.updateTenantParent(CHILD, 42, ACTOR)).rejects.toMatchObject({ status: 400 });
  });

  it("answers 404 for an unknown tenant or parent", async () => {
    await expect(svc.updateTenantParent("00000000-0000-4000-8000-00000000dead", OTHER, ACTOR)).rejects.toMatchObject({
      status: 404,
      message: "Tenant not found",
    });
    await expect(svc.updateTenantParent(CHILD, "00000000-0000-4000-8000-00000000dead", ACTOR)).rejects.toMatchObject({
      status: 404,
      message: "New parent tenant not found",
    });
  });

  it("refuses (409) a tenant or parent that has no code to build a path from", async () => {
    tenantOf(OTHER).code = null;
    await expect(svc.updateTenantParent(CHILD, OTHER, ACTOR)).rejects.toMatchObject({ status: 409 });
    tenantOf(CHILD).code = null;
    await expect(svc.updateTenantParent(CHILD, OTHER, ACTOR)).rejects.toMatchObject({
      status: 409,
      message: "This tenant has no code; set one before moving it in the hierarchy (its path is built from it)",
    });
  });

  it("refuses (409) a move that would push the subtree past the maximum depth", async () => {
    // HQ's subtree is 2 levels below it; under a depth-4 parent it would reach 7 > 5.
    const DEEP = "00000000-0000-4000-8000-0000000000c1";
    mockState.tenants.push(tenant(DEEP, "DEEP", null));
    mockState.rows.push(hrow(DEEP, "DEEP", "X", "/x/y/z/w/deep", 4));

    await expect(svc.updateTenantParent(HQ, DEEP, ACTOR)).rejects.toMatchObject({
      status: 409,
      message: "Moving this tenant there would put its subtree 7 levels deep; the maximum is 5",
    });
  });

  it("creates the hierarchy row of a tenant that had none", async () => {
    const LONE = "00000000-0000-4000-8000-0000000000d1";
    mockState.tenants.push(tenant(LONE, "LONE", null));

    const res = await svc.updateTenantParent(LONE, HQ, ACTOR);

    expect(res).toMatchObject({ path: "/hq/lone", depth: 1, descendantsMoved: 0 });
    expect(rowOf(LONE)).toMatchObject({ tenantCode: "LONE", parentCode: "HQ", path: "/hq/lone", depth: 1 });
  });

  it("treats `_` in a code literally: a sibling whose path merely matches the wildcard is not moved", async () => {
    // "/hq/hq_001/%" as an unescaped LIKE would also match "/hq/hqx001/…".
    const LOOKALIKE = "00000000-0000-4000-8000-0000000000e1";
    mockState.tenants.push(tenant(LOOKALIKE, "HQX001_001", HQ));
    mockState.rows.push(hrow(LOOKALIKE, "HQX001_001", "HQ", "/hq/hqx001/hqx001_001", 2));

    await svc.updateTenantParent(CHILD, OTHER, ACTOR);

    expect(rowOf(LOOKALIKE).path).toBe("/hq/hqx001/hqx001_001");
  });
});

describe("A-224 — removeTenantParent", () => {
  it("makes the tenant a root, moving its subtree with it, audited as DETACH_TENANT", async () => {
    const res = await svc.removeTenantParent(CHILD, ACTOR);

    expect(res).toEqual({ tenantId: CHILD, parentId: null, path: "/hq_001", depth: 0, descendantsMoved: 1 });
    expect(tenantOf(CHILD).parentId).toBeNull();
    expect(rowOf(CHILD)).toMatchObject({ parentCode: null, path: "/hq_001", depth: 0 });
    expect(rowOf(GRANDCHILD)).toMatchObject({ path: "/hq_001/hq_001_001", depth: 1 });
    expect(mockState.audit[0].row.changes.operation).toBe("DETACH_TENANT");
  });

  it("with no actor given, the audit row names none (the route always passes one)", async () => {
    await svc.removeTenantParent(CHILD);

    expect(mockState.audit[0].row).toMatchObject({ userId: undefined, ipAddress: undefined });
  });

  it('"already a root" is a 409 state conflict, not a 404', async () => {
    await expect(svc.removeTenantParent(HQ, ACTOR)).rejects.toMatchObject({
      status: 409,
      message: "This tenant is already a root tenant: it has no parent to remove",
    });
  });
});
