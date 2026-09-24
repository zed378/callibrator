/**
 * A-38 / A-39 / A-49 — SCIM Groups are tenant-owned, say what they grant, and
 * cannot be probed across tenants (ADR-053).
 *
 * Before 2026-09-24 a SCIM Group WAS a row in the global `roles` table:
 *  - A-38: `GET /Groups` listed every tenant's groups, `POST /Groups` answered
 *    409 for a name another tenant held, and `DELETE /Groups/:id` destroyed a
 *    role every tenant shared;
 *  - A-39: a created group was a role with roleLevel 1 and no menu grants, so
 *    its members got nothing and the IdP was told "created";
 *  - A-49: `displayName eq` was case-sensitive against an uppercased column,
 *    and a malformed id in a patch value reached a UUID column (a 500).
 *
 * Through the REAL chain: scim.route → scim.controller → scim.service. Only
 * `auth` (to set the API-key principal) and the models are stubbed. The model
 * doubles are a small in-memory database that behaves as PostgreSQL does after
 * migration 0042: `scim_groups` is filtered by tenant, its two unique indexes
 * raise the error Sequelize raises on a 23505, and `sequelize.transaction`
 * rolls every write back when the work throws.
 *
 * Tenants and principals come from createTwoTenants() (A-63).
 *
 * What this cannot prove: the catalog. Migration 0042 was verified separately
 * against PostgreSQL 18 (up, re-run, down, pg_indexes) — see the A-38 card.
 */

const { createTwoTenants } = require("../fixtures/twoTenants");

const fx = createTwoTenants();
const TENANT_A = fx.tenantA.id;
const TENANT_B = fx.tenantB.id;

const ROLE_TECH = "11111111-1111-4111-8111-111111111111";
const ROLE_ADMIN = "22222222-2222-4222-8222-222222222222";
const ROLE_EMPTY = "33333333-3333-4333-8333-333333333333";
const USER_A1 = "a1a1a1a1-0000-4000-8000-000000000001";
const USER_A2 = "a1a1a1a1-0000-4000-8000-000000000002";
const USER_B1 = "b1b1b1b1-0000-4000-8000-000000000001";
const MISSING = "99999999-9999-4999-8999-999999999999";

const mockState = { tenantId: null, groups: [], users: [], roles: [], grants: {}, seq: 0, roleWrites: 0 };

jest.mock("../../middlewares/auth.middleware", () => {
  const actual = jest.requireActual("../../middlewares/auth.middleware");
  return {
    ...actual,
    auth: (req, res, next) => {
      req.user = {
        id: "api-key-1",
        isApiKey: true,
        apiKeyScopes: ["scim:write"],
        tenantId: mockState.tenantId,
        role: { name: "USER" },
      };
      next();
    },
  };
});

jest.mock("../../models", () => {
  const { Op: SeqOp, UniqueConstraintError } = require("sequelize");

  /** Does a row satisfy a Sequelize `where` of the shapes the service uses? */
  const matches = (row, where = {}) => {
    for (const [key, cond] of Object.entries(where)) {
      if (cond && typeof cond === "object" && SeqOp.in in cond) {
        if (!cond[SeqOp.in].includes(row[key])) {return false;}
      } else if (cond && typeof cond === "object" && SeqOp.ne in cond) {
        if (row[key] === cond[SeqOp.ne]) {return false;}
      } else if (row[key] !== cond) {
        return false;
      }
    }
    // [Op.and]: [where(fn("lower", col("display_name")), value)]
    for (const clause of where[SeqOp.and] || []) {
      if (String(row.displayName).toLowerCase() !== clause.logic) {return false;}
    }
    return true;
  };

  const groupRow = (values) => {
    const row = {
      ...values,
      createdAt: new Date("2026-09-24T00:00:00Z"),
      updatedAt: new Date("2026-09-24T00:00:00Z"),
      async update(changes) {
        const next = { ...row, ...changes };
        assertUnique(next, row.id);
        Object.assign(row, changes);
        return row;
      },
      async destroy() {
        mockState.groups = mockState.groups.filter((g) => g !== row);
      },
    };
    return row;
  };

  // migration 0042: UNIQUE (tenant_id, lower(display_name)), UNIQUE (tenant_id, role_id)
  const assertUnique = (next, selfId) => {
    const clash = mockState.groups.find(
      (g) =>
        g.id !== selfId &&
        g.tenantId === next.tenantId &&
        (g.displayName.toLowerCase() === next.displayName.toLowerCase() ||
          (next.roleId && g.roleId === next.roleId)),
    );
    if (clash) {
      throw new UniqueConstraintError({ message: "Validation error", parent: { code: "23505" } });
    }
  };

  const snapshot = () => ({
    groups: mockState.groups.map((g) => ({ g, fields: { displayName: g.displayName, roleId: g.roleId } })),
    users: mockState.users.map((u) => ({ ...u })),
  });
  const restore = (snap) => {
    mockState.groups = snap.groups.map(({ g, fields }) => Object.assign(g, fields));
    mockState.users = snap.users;
  };

  const models = {
    sequelize: {
      // All-or-nothing, as a PostgreSQL transaction is.
      transaction: async (work) => {
        const snap = snapshot();
        try {
          return await work({ id: "tx" });
        } catch (error) {
          restore(snap);
          throw error;
        }
      },
    },
    ScimGroup: {
      findOne: jest.fn(async ({ where }) => mockState.groups.find((g) => matches(g, where)) || null),
      findAndCountAll: jest.fn(async ({ where, offset, limit }) => {
        const all = mockState.groups.filter((g) => matches(g, where));
        return { count: all.length, rows: all.slice(offset, offset + limit) };
      }),
      create: jest.fn(async (values) => {
        assertUnique(values, null);
        mockState.seq += 1;
        const row = groupRow({ id: `${String(mockState.seq).padStart(8, "0")}-0000-4000-8000-000000000000`, ...values });
        mockState.groups.push(row);
        return row;
      }),
    },
    Users: {
      findAll: jest.fn(async ({ where }) => mockState.users.filter((u) => matches(u, where))),
      update: jest.fn(async (values, { where }) => {
        const hit = mockState.users.filter((u) => matches(u, where));
        hit.forEach((u) => Object.assign(u, values));
        return [hit.length];
      }),
    },
    Role: {
      findOne: jest.fn(async ({ where }) => mockState.roles.find((r) => r.id === where.id) || null),
      // Any attempt to write a role is counted: SCIM must never do it (A-38).
      create: jest.fn(async () => { mockState.roleWrites += 1; }),
      update: jest.fn(async () => { mockState.roleWrites += 1; }),
      destroy: jest.fn(async () => { mockState.roleWrites += 1; }),
    },
    RoleMenuPermission: {
      count: jest.fn(async ({ where }) => mockState.grants[where.roleId] || 0),
    },
  };
  return models;
});

const { ROLE_IDS } = require("../../constants");
const scimRouter = require("../../routes/api/scim.route");

// Express's own router.handle with a minimal req/res pair (the harness of
// scim.crossTenantOracle.a37.test.js).
const call = (tenantId, method, url, body) =>
  new Promise((resolve) => {
    mockState.tenantId = tenantId;
    const [path, qs] = url.split("?");
    const query = qs ? Object.fromEntries(new URLSearchParams(qs)) : {};
    const res = {
      statusCode: 200,
      headersSent: false,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.headersSent = true;
        // `details` carries the stack outside production (response.util), and
        // an async stack differs by call path; what a client in production
        // receives is everything else.
        const { details: _details, ...wire } = payload || {};
        resolve({ status: this.statusCode, body: payload, text: JSON.stringify(wire) });
        return this;
      },
      setHeader() {
        return this;
      },
    };
    const req = {
      method,
      url: path,
      originalUrl: `/api/v1/scim/v2${path}`,
      body,
      query,
      params: {},
      headers: {},
      ip: "127.0.0.1",
      get: () => undefined,
    };
    scimRouter.handle(req, res, (err) =>
      resolve({ status: err ? err.status || 500 : 404, body: null, text: "" }),
    );
  });

const EXT = "urn:ietf:params:scim:schemas:extension:callibrator:2.0:Group";

const seed = () => {
  mockState.seq = 0;
  mockState.roleWrites = 0;
  mockState.roles = [
    { id: ROLE_TECH, name: "TECHNICIAN", nameToShow: "Technician", isSystem: true },
    { id: ROLE_ADMIN, name: "HEALTHCARE ADMIN", nameToShow: null, isSystem: true },
    { id: ROLE_EMPTY, name: "SCIM-LEFTOVER", nameToShow: null, isSystem: false },
    { id: ROLE_IDS.SUPER_ADMIN, name: "SUPERADMIN", isSystem: true },
    { id: ROLE_IDS.USER, name: "USER", isSystem: true },
  ];
  mockState.grants = { [ROLE_TECH]: 12, [ROLE_ADMIN]: 30, [ROLE_IDS.USER]: 3, [ROLE_IDS.SUPER_ADMIN]: 40 };
  mockState.users = [
    { id: USER_A1, tenantId: TENANT_A, email: "a1@hospital-a.test", roleId: ROLE_IDS.USER },
    { id: USER_A2, tenantId: TENANT_A, email: "a2@hospital-a.test", roleId: ROLE_ADMIN },
    { id: USER_B1, tenantId: TENANT_B, email: "b1@hospital-b.test", roleId: ROLE_TECH },
  ];
  mockState.groups = [];
};

const userRole = (id) => mockState.users.find((u) => u.id === id).roleId;

describe("A-38 — SCIM Groups belong to one tenant", () => {
  let groupB;

  beforeEach(async () => {
    seed();
    groupB = (await call(TENANT_B, "POST", "/Groups", { displayName: "Engineers", roleId: ROLE_TECH })).body.data;
  });

  it("GET /Groups lists only the caller's tenant's groups", async () => {
    await call(TENANT_A, "POST", "/Groups", { displayName: "Nurses" });

    const res = await call(TENANT_A, "GET", "/Groups");

    expect(res.status).toBe(200);
    expect(res.body.data.totalResults).toBe(1);
    expect(res.body.data.Resources.map((g) => g.displayName)).toEqual(["Nurses"]);
  });

  it("every :id route answers 404 for another tenant's group, byte-identical to an id that does not exist", async () => {
    const probes = [
      ["GET", undefined],
      ["PUT", { displayName: "Taken over" }],
      ["PATCH", { Operations: [{ op: "add", path: "members", value: [{ value: USER_A1 }] }] }],
      ["DELETE", undefined],
    ];
    for (const [method, body] of probes) {
      const foreign = await call(TENANT_A, method, `/Groups/${groupB.id}`, body);
      const missing = await call(TENANT_A, method, `/Groups/${MISSING}`, body);
      const malformed = await call(TENANT_A, method, "/Groups/not-a-uuid", body);

      expect(foreign.status).toBe(404);
      expect(foreign.text).toBe(missing.text);
      expect(malformed.text).toBe(missing.text);
    }

    // Tenant B's group and member are exactly as they were.
    const still = await call(TENANT_B, "GET", `/Groups/${groupB.id}`);
    expect(still.body.data.displayName).toBe("Engineers");
    expect(still.body.data.members).toEqual([{ value: USER_B1, display: "b1@hospital-b.test" }]);
    expect(userRole(USER_A1)).toBe(ROLE_IDS.USER);
  });

  it("POST /Groups with a name another tenant already uses is 201 — not the 409 that disclosed it", async () => {
    const res = await call(TENANT_A, "POST", "/Groups", { displayName: "ENGINEERS" });

    expect(res.status).toBe(201);
    expect(res.body.data.displayName).toBe("ENGINEERS");
  });

  it("another tenant may map the same role; each tenant's group lists only its own members", async () => {
    const res = await call(TENANT_A, "POST", "/Groups", { displayName: "Techs", roleId: ROLE_TECH });

    expect(res.status).toBe(201);
    expect(res.body.data.members).toEqual([]);
  });

  it("DELETE /Groups/:id removes the tenant's group and no role — another tenant's members keep their role", async () => {
    const own = (await call(TENANT_A, "POST", "/Groups", { displayName: "Techs", roleId: ROLE_TECH })).body.data;

    const res = await call(TENANT_A, "DELETE", `/Groups/${own.id}`);

    expect(res.status).toBe(204);
    expect(mockState.roles.map((r) => r.id)).toContain(ROLE_TECH);
    expect(mockState.roleWrites).toBe(0);
    expect(userRole(USER_B1)).toBe(ROLE_TECH);
    expect((await call(TENANT_B, "GET", `/Groups/${groupB.id}`)).status).toBe(200);
  });

  it("SCIM never creates, renames or deletes a role", async () => {
    const g = (await call(TENANT_A, "POST", "/Groups", { displayName: "Techs", roleId: ROLE_TECH })).body.data;
    await call(TENANT_A, "PUT", `/Groups/${g.id}`, { displayName: "Technicians" });
    await call(TENANT_A, "PATCH", `/Groups/${g.id}`, { Operations: [{ op: "replace", path: "displayName", value: "T" }] });
    await call(TENANT_A, "DELETE", `/Groups/${g.id}`);

    expect(mockState.roleWrites).toBe(0);
  });

  it("DELETE demotes the group's members in the caller's tenant only", async () => {
    const own = (await call(TENANT_A, "POST", "/Groups", { displayName: "Admins", roleId: ROLE_ADMIN })).body.data;
    expect(own.members.map((m) => m.value)).toEqual([USER_A2]);

    await call(TENANT_A, "DELETE", `/Groups/${own.id}`);

    expect(userRole(USER_A2)).toBe(ROLE_IDS.USER);
    expect(userRole(USER_B1)).toBe(ROLE_TECH);
  });

  it("a principal with no tenant is refused rather than reaching the database with an undefined tenant", async () => {
    const res = await call(null, "GET", "/Groups");

    expect(res.status).toBe(403);
  });
});

describe("A-39 — a SCIM group says what it grants, and never grants nothing silently", () => {
  beforeEach(seed);

  it("an unmapped group is created, and its response says it grants nothing", async () => {
    const res = await call(TENANT_A, "POST", "/Groups", { displayName: "Nurses" });

    expect(res.status).toBe(201);
    expect(res.body.data[EXT]).toEqual({ roleId: null, roleName: null, grantsAccess: false });
    expect(res.body.data.schemas).toContain(EXT);
  });

  it("adding a member to an unmapped group is a 409 naming the fix, and changes no one's role", async () => {
    const g = (await call(TENANT_A, "POST", "/Groups", { displayName: "Nurses" })).body.data;

    const res = await call(TENANT_A, "PATCH", `/Groups/${g.id}`, {
      Operations: [{ op: "add", path: "members", value: [{ value: USER_A1 }] }],
    });

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/not mapped to a role.*grant nothing.*roleId/);
    expect(userRole(USER_A1)).toBe(ROLE_IDS.USER);
  });

  it("POST /Groups with members but no roleId is a 409, and no group is created", async () => {
    const res = await call(TENANT_A, "POST", "/Groups", {
      displayName: "Nurses",
      members: [{ value: USER_A1 }],
    });

    expect(res.status).toBe(409);
    expect(mockState.groups).toHaveLength(0);
  });

  it("a group mapped to a role grants it: members take the role and the response names it", async () => {
    const res = await call(TENANT_A, "POST", "/Groups", {
      displayName: "Techs",
      roleId: ROLE_TECH,
      members: [{ value: USER_A1 }],
    });

    expect(res.status).toBe(201);
    expect(userRole(USER_A1)).toBe(ROLE_TECH);
    expect(res.body.data[EXT]).toEqual({ roleId: ROLE_TECH, roleName: "Technician", grantsAccess: true });
    expect(res.body.data.members).toEqual([{ value: USER_A1, display: "a1@hospital-a.test" }]);
  });

  it("mapping to a role that grants no menu permission is refused with 400 — the A-39 role by another route", async () => {
    const res = await call(TENANT_A, "POST", "/Groups", { displayName: "Leftover", roleId: ROLE_EMPTY });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/SCIM-LEFTOVER.*grants no menu permission/);
    expect(mockState.groups).toHaveLength(0);
  });

  it("mapping to SUPERADMIN is 403 (the A-27 guard), to the default USER role 400, to an unknown role 400", async () => {
    expect((await call(TENANT_A, "POST", "/Groups", { displayName: "x", roleId: ROLE_IDS.SUPER_ADMIN })).status).toBe(403);
    expect((await call(TENANT_A, "POST", "/Groups", { displayName: "y", roleId: ROLE_IDS.USER })).status).toBe(400);
    expect((await call(TENANT_A, "POST", "/Groups", { displayName: "z", roleId: MISSING })).status).toBe(400);
    expect(mockState.groups).toHaveLength(0);
  });

  it("an unmapped group can be mapped by PATCH path roleId, then accepts members in the same request", async () => {
    const g = (await call(TENANT_A, "POST", "/Groups", { displayName: "Techs" })).body.data;

    const res = await call(TENANT_A, "PATCH", `/Groups/${g.id}`, {
      Operations: [
        { op: "replace", path: "roleId", value: ROLE_TECH },
        { op: "add", path: "members", value: [{ value: USER_A1 }] },
      ],
    });

    expect(res.status).toBe(200);
    expect(res.body.data[EXT].grantsAccess).toBe(true);
    expect(userRole(USER_A1)).toBe(ROLE_TECH);
  });

  it("re-mapping a group moves its members to the new role; removing roleId demotes them", async () => {
    const g = (await call(TENANT_A, "POST", "/Groups", { displayName: "Admins", roleId: ROLE_ADMIN })).body.data;

    await call(TENANT_A, "PUT", `/Groups/${g.id}`, { displayName: "Admins", roleId: ROLE_TECH });
    expect(userRole(USER_A2)).toBe(ROLE_TECH);

    const res = await call(TENANT_A, "PATCH", `/Groups/${g.id}`, { Operations: [{ op: "remove", path: "roleId" }] });
    expect(res.status).toBe(200);
    expect(res.body.data[EXT].roleId).toBeNull();
    expect(userRole(USER_A2)).toBe(ROLE_IDS.USER);
  });

  it("PUT without roleId keeps the mapping — an IdP rename never demotes the members", async () => {
    const g = (await call(TENANT_A, "POST", "/Groups", { displayName: "Admins", roleId: ROLE_ADMIN })).body.data;

    const res = await call(TENANT_A, "PUT", `/Groups/${g.id}`, { displayName: "Administrators" });

    expect(res.body.data[EXT].roleId).toBe(ROLE_ADMIN);
    expect(userRole(USER_A2)).toBe(ROLE_ADMIN);
  });

  it("a role backs at most one group per tenant: a second mapping is a 409 naming the first group", async () => {
    await call(TENANT_A, "POST", "/Groups", { displayName: "Techs", roleId: ROLE_TECH });
    const other = (await call(TENANT_A, "POST", "/Groups", { displayName: "Field" })).body.data;

    const created = await call(TENANT_A, "POST", "/Groups", { displayName: "Techs 2", roleId: ROLE_TECH });
    const remapped = await call(TENANT_A, "PATCH", `/Groups/${other.id}`, {
      Operations: [{ op: "add", path: "roleId", value: ROLE_TECH }],
    });

    expect(created.status).toBe(409);
    expect(created.body.message).toMatch(/already mapped to the group "Techs"/);
    expect(remapped.status).toBe(409);
  });
});

describe("A-49 — displayName is case-insensitive, patch ids are validated, and writes are atomic", () => {
  beforeEach(seed);

  it("displayName eq finds a group however the IdP capitalises it", async () => {
    await call(TENANT_A, "POST", "/Groups", { displayName: "Engineers" });

    const res = await call(TENANT_A, "GET", '/Groups?filter=displayName eq "ENGINEERS"');

    expect(res.body.data.totalResults).toBe(1);
    expect(res.body.data.Resources[0].displayName).toBe("Engineers");
  });

  it("a case variant of the caller's own group is a 409 — the probe and the create now agree", async () => {
    await call(TENANT_A, "POST", "/Groups", { displayName: "Engineers" });

    expect((await call(TENANT_A, "POST", "/Groups", { displayName: "engineers" })).status).toBe(409);
  });

  it("a rename onto another group's name is a 409; a rename onto its own name in another case is allowed", async () => {
    const eng = (await call(TENANT_A, "POST", "/Groups", { displayName: "Engineers" })).body.data;
    await call(TENANT_A, "POST", "/Groups", { displayName: "Nurses" });

    expect((await call(TENANT_A, "PUT", `/Groups/${eng.id}`, { displayName: "NURSES" })).status).toBe(409);
    expect((await call(TENANT_A, "PUT", `/Groups/${eng.id}`, { displayName: "ENGINEERS" })).status).toBe(200);
  });

  it("an unsupported group filter is a 400, as it is on /Users — not every group", async () => {
    const res = await call(TENANT_A, "GET", '/Groups?filter=externalId eq "x"');

    expect(res.status).toBe(400);
  });

  it("count is bounded at 200", async () => {
    await call(TENANT_A, "POST", "/Groups", { displayName: "Engineers" });
    await call(TENANT_A, "GET", "/Groups?count=100000");

    const { ScimGroup } = require("../../models");
    expect(ScimGroup.findAndCountAll).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 200 }));
  });

  it("a malformed member id in a patch value is a 400, not a driver error", async () => {
    const g = (await call(TENANT_A, "POST", "/Groups", { displayName: "Techs", roleId: ROLE_TECH })).body.data;

    for (const op of [
      { op: "add", path: "members", value: [{ value: "not-a-uuid" }] },
      { op: "remove", path: 'members[value eq "not-a-uuid"]' },
      { op: "replace", path: "roleId", value: "not-a-uuid" },
    ]) {
      const res = await call(TENANT_A, "PATCH", `/Groups/${g.id}`, { Operations: [op] });
      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/must be a UUID/);
    }
  });

  it("a malformed roleId in a user patch is a 400, not a driver error", async () => {
    const { Users } = require("../../models");
    Users.findOne = jest.fn(async () => ({ id: USER_A1, update: jest.fn() }));

    const res = await call(TENANT_A, "PATCH", `/Users/${USER_A1}`, {
      Operations: [{ op: "replace", path: "roleId", value: "not-a-uuid" }],
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("SCIM roleId must be a UUID");
    delete Users.findOne;
  });

  it("removing a user who is not a member leaves their real role alone", async () => {
    const g = (await call(TENANT_A, "POST", "/Groups", { displayName: "Techs", roleId: ROLE_TECH })).body.data;

    await call(TENANT_A, "PATCH", `/Groups/${g.id}`, {
      Operations: [{ op: "remove", path: `members[value eq "${USER_A2}"]` }],
    });

    expect(userRole(USER_A2)).toBe(ROLE_ADMIN);
  });

  it("a multi-operation PATCH that fails partway changes nothing", async () => {
    const g = (await call(TENANT_A, "POST", "/Groups", { displayName: "Techs", roleId: ROLE_TECH })).body.data;

    const res = await call(TENANT_A, "PATCH", `/Groups/${g.id}`, {
      Operations: [
        { op: "replace", path: "displayName", value: "Renamed" },
        { op: "add", path: "members", value: [{ value: USER_A1 }] },
        { op: "replace", path: "bogus", value: "x" },
      ],
    });

    expect(res.status).toBe(400);
    expect(userRole(USER_A1)).toBe(ROLE_IDS.USER);
    expect((await call(TENANT_A, "GET", `/Groups/${g.id}`)).body.data.displayName).toBe("Techs");
  });

  it("losing the race to the unique index is the same 409, not a 500", async () => {
    const { ScimGroup } = require("../../models");
    // The pre-insert check misses (a concurrent request has not committed yet)...
    ScimGroup.findOne.mockResolvedValueOnce(null);
    await call(TENANT_A, "POST", "/Groups", { displayName: "Engineers" });
    ScimGroup.findOne.mockResolvedValueOnce(null);

    // ...and the index rejects the insert.
    const res = await call(TENANT_A, "POST", "/Groups", { displayName: "engineers" });

    expect(res.status).toBe(409);
    expect(res.body.message).toBe("Group already exists");
  });
});

describe("PATCH /Groups — the RFC 7644 shapes A-33 accepted, on tenant-owned groups", () => {
  let g;

  beforeEach(async () => {
    seed();
    g = (await call(TENANT_A, "POST", "/Groups", { displayName: "Techs", roleId: ROLE_TECH })).body.data;
  });

  const patch = (Operations) => call(TENANT_A, "PATCH", `/Groups/${g.id}`, { Operations });

  it("resolves a members path carrying the core Group schema URN, with members given as strings", async () => {
    const res = await patch([
      { op: "add", path: "urn:ietf:params:scim:schemas:core:2.0:Group:members", value: [USER_A1] },
    ]);

    expect(res.status).toBe(200);
    expect(userRole(USER_A1)).toBe(ROLE_TECH);
  });

  it("accepts the value-object form for displayName, roleId and members in one operation", async () => {
    const res = await patch([
      { op: "replace", value: { displayName: "Admins", roleId: ROLE_ADMIN, members: [{ value: USER_A1 }] } },
    ]);

    expect(res.status).toBe(200);
    expect(res.body.data.displayName).toBe("Admins");
    expect(res.body.data[EXT].roleId).toBe(ROLE_ADMIN);
    expect(res.body.data.members.map((m) => m.value).sort()).toEqual([USER_A1, USER_A2].sort());
  });

  it("removes the members named in the value, and empties the group when remove members carries no value", async () => {
    await patch([{ op: "add", path: "members", value: [{ value: USER_A1 }, { value: USER_A2 }] }]);

    await patch([{ op: "remove", path: "members", value: [{ value: USER_A1 }] }]);
    expect(userRole(USER_A1)).toBe(ROLE_IDS.USER);
    expect(userRole(USER_A2)).toBe(ROLE_TECH);

    await patch([{ op: "remove", path: "members" }]);
    expect(userRole(USER_A2)).toBe(ROLE_IDS.USER);
    expect(userRole(USER_B1)).toBe(ROLE_TECH); // tenant B untouched
  });

  it("removing members from an unmapped group is a true no-op — it has none", async () => {
    const unmapped = (await call(TENANT_A, "POST", "/Groups", { displayName: "Nurses" })).body.data;

    const res = await call(TENANT_A, "PATCH", `/Groups/${unmapped.id}`, {
      Operations: [{ op: "remove", path: "members" }, { op: "remove", path: "roleId" }],
    });

    expect(res.status).toBe(200);
    expect(mockState.users.map((u) => u.roleId)).toEqual([ROLE_IDS.USER, ROLE_ADMIN, ROLE_TECH]);
  });

  it("PUT assigns the members it lists and leaves a same-role mapping alone", async () => {
    const res = await call(TENANT_A, "PUT", `/Groups/${g.id}`, {
      displayName: "Techs",
      roleId: ROLE_TECH,
      members: [{ value: USER_A1 }],
    });

    expect(res.status).toBe(200);
    expect(userRole(USER_A1)).toBe(ROLE_TECH);
  });

  it.each([
    ["an unsupported path", [{ op: "replace", path: "externalId", value: "x" }]],
    ["a non-string path", [{ op: "replace", path: 7, value: "x" }]],
    ["an empty members value", [{ op: "add", path: "members", value: [] }]],
    ["removing displayName", [{ op: "remove", path: "displayName" }]],
    ["a non-string displayName", [{ op: "replace", path: "displayName", value: 7 }]],
    ["an empty value object", [{ op: "replace", value: {} }]],
    ["neither a path nor an object value", [{ op: "replace", value: "x" }]],
    ["an unknown op", [{ op: "move", path: "members", value: [] }]],
  ])("rejects %s with 400", async (_label, Operations) => {
    const res = await patch(Operations);

    expect(res.status).toBe(400);
  });
});

describe("scim.service groups — inputs the route's validator never lets through", () => {
  const scim = require("../../services/scim.service");

  beforeEach(seed);

  it("getGroups defaults to the first page of 100 with no filter", async () => {
    await scim.createGroup(TENANT_A, { displayName: "Admins", roleId: ROLE_ADMIN });

    const list = await scim.getGroups(TENANT_A);

    expect(list.startIndex).toBe(1);
    // A role with no display label is named by its name.
    expect(list.Resources[0][EXT].roleName).toBe("HEALTHCARE ADMIN");
  });

  it("updateGroup without a displayName leaves the name alone", async () => {
    const g = await scim.createGroup(TENANT_A, { displayName: "Techs", roleId: ROLE_TECH });

    const res = await scim.updateGroup(TENANT_A, g.id, { members: [] });

    expect(res.displayName).toBe("Techs");
  });

  it("a non-string patch path is a 400", async () => {
    const g = await scim.createGroup(TENANT_A, { displayName: "Techs" });

    await expect(scim.patchGroup(TENANT_A, g.id, [{ op: "add", path: 7, value: [] }])).rejects.toMatchObject({ status: 400 });
  });

  it("add with Okta's members[value eq] filter path, and a bare member id as the value, both assign", async () => {
    const g = await scim.createGroup(TENANT_A, { displayName: "Techs", roleId: ROLE_TECH });

    await scim.patchGroup(TENANT_A, g.id, [{ op: "add", path: `members[value eq "${USER_A1}"]` }]);
    await scim.patchGroup(TENANT_A, g.id, [{ op: "add", path: "members", value: USER_A2 }]);

    expect(userRole(USER_A1)).toBe(ROLE_TECH);
    expect(userRole(USER_A2)).toBe(ROLE_TECH);
  });
});
