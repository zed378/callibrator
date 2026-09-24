/**
 * createTwoTenants() — the two-tenant fixture CLAUDE.md asks for (A-55, A-63).
 *
 * CLAUDE.md: "Every new `:id` route needs a two-tenant test asserting 404".
 * This is the cheap way to write one without a database. It builds:
 *
 *  - two tenants, A and B, as Sequelize-instance-shaped rows (`update`, `get`)
 *    with real UUID ids, so real Joi validators accept them;
 *  - principals shaped exactly like `req.user` as auth.middleware builds it
 *    (authService.getAuthUserWithTenant: `role { id, name, roleLevel }`,
 *    `tenant { id, name, status }`, `tenantId`, `isActive`, `status`);
 *  - `Tenants` / `Users` model doubles whose lookups resolve against those
 *    rows. `Tenants.findByPk` is deliberately NOT tenant-scoped — the real
 *    `tenants` table is not, which is exactly why a service must check
 *    ownership itself;
 *  - a transaction double: `row.update(values, { transaction })` applies at
 *    once (as a Sequelize instance does) and is UNDONE by `rollback()`, so a
 *    request that fails after writing cannot leave a half-applied change in
 *    the fixture — the row reads as the database would.
 *  - `snapshot(tenant)` for "tenant B is unchanged" assertions.
 *
 * It is a fixture, not the database: no constraints, no hooks, no SQL. Use it
 * for authorization behaviour through the real middleware/controller/service
 * chain; test grants and SQL against PostgreSQL.
 *
 * API
 * ---
 *   const fx = createTwoTenants();
 *   fx.tenantA, fx.tenantB             // tenant rows (mutable instances)
 *   fx.principal(fx.tenantA, "USER")   // req.user for a role (ROLE_NAMES key
 *                                      // or role name); same tenant+role →
 *                                      // same principal object
 *   fx.superAdmin                      // SUPERADMIN principal, home tenant A
 *   fx.Tenants                         // { findByPk, findOne } doubles
 *   fx.Users                           // { findByPk } over every principal
 *   fx.transaction()                   // Promise<tx> with commit/rollback
 *   fx.snapshot(row)                   // plain copy of a row's fields
 *
 * Wire it through `jest.mock("../../models", ...)` and
 * `jest.mock("../../config", ...)`; see routes/tenant.edit.a63.test.js.
 */

const { ROLE_NAMES, ROLE_LEVELS } = require("../../constants/roleConstants");

const TENANT_A_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TENANT_B_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const TENANT_FIELDS = [
  "id",
  "name",
  "code",
  "description",
  "logo",
  "primaryColor",
  "status",
  "maxUsers",
  "email",
  "phone",
  "address",
  "city",
  "state",
  "zipCode",
  "country",
  "website",
];

/** Resolve "USER" / "HEALTCARE_ADMIN" (ROLE_NAMES keys) or a role name. */
const resolveRole = (role) => {
  if (Object.prototype.hasOwnProperty.call(ROLE_NAMES, role)) {
    return { key: role, name: ROLE_NAMES[role] };
  }
  const key = Object.keys(ROLE_NAMES).find((k) => ROLE_NAMES[k] === role);
  if (!key) {
    throw new Error(`createTwoTenants: unknown role "${role}"`);
  }
  return { key, name: role };
};

const hex = (n, width) => n.toString(16).padStart(width, "0");

const createTwoTenants = () => {
  let userSeq = 0;
  const pending = new Map(); // tx -> [[row, priorValues]] (the undo log)

  const makeTenantRow = (fields) => {
    const row = {
      ...fields,
      get(opts) {
        return opts && opts.plain ? snapshot(row) : row;
      },
      toJSON() {
        return snapshot(row);
      },
      async update(values, options = {}) {
        if (options.transaction) {
          if (!pending.has(options.transaction)) {
            throw new Error("createTwoTenants: update in a finished transaction");
          }
          // Sequelize reflects the new values on the instance at once, and
          // the service reads them before COMMIT (audit diff, cache). Apply
          // now; keep the prior values so rollback() can restore them.
          const prior = {};
          for (const key of Object.keys(values)) {
            prior[key] = row[key];
          }
          pending.get(options.transaction).push([row, prior]);
          Object.assign(row, values);
          return row;
        }
        Object.assign(row, values);
        return row;
      },
    };
    return row;
  };

  const snapshot = (row) => {
    const out = {};
    for (const field of TENANT_FIELDS) {
      out[field] = row[field];
    }
    return out;
  };

  const tenantA = makeTenantRow({
    id: TENANT_A_ID,
    name: "Hospital A",
    code: "HOSP-A",
    description: null,
    logo: null,
    primaryColor: null,
    status: "ACTIVE",
    maxUsers: 10,
    email: "admin@hospital-a.test",
    phone: null,
    address: null,
    city: null,
    state: null,
    zipCode: null,
    country: null,
    website: null,
  });
  const tenantB = makeTenantRow({
    id: TENANT_B_ID,
    name: "Hospital B",
    code: "HOSP-B",
    description: null,
    logo: null,
    primaryColor: null,
    status: "ACTIVE",
    maxUsers: 25,
    email: "admin@hospital-b.test",
    phone: null,
    address: null,
    city: null,
    state: null,
    zipCode: null,
    country: null,
    website: null,
  });
  const tenants = [tenantA, tenantB];

  const principals = new Map(); // `${tenantId}:${roleName}` -> principal

  const principal = (tenant, role) => {
    const { key, name } = resolveRole(role);
    const cacheKey = `${tenant.id}:${name}`;
    if (!principals.has(cacheKey)) {
      userSeq += 1;
      principals.set(cacheKey, {
        id: `cccccccc-cccc-4ccc-8ccc-${hex(userSeq, 12)}`,
        username: `${key.toLowerCase()}${userSeq}`,
        tenantId: tenant.id,
        tenant: { id: tenant.id, name: tenant.name, status: tenant.status },
        role: {
          id: `dddddddd-dddd-4ddd-8ddd-${hex(userSeq, 12)}`,
          name,
          roleLevel: ROLE_LEVELS[key],
        },
        isActive: true,
        status: "ACTIVE",
        isApiKey: false,
        // P6-07: a platform operator (level 10) without MFA gets an
        // enrolment-only session, so the fixture's operator has enrolled.
        ...(ROLE_LEVELS[key] >= 10 ? { mfaEnabled: true } : {}),
      });
    }
    return principals.get(cacheKey);
  };

  const superAdmin = principal(tenantA, "SUPER_ADMIN");

  const Tenants = {
    findByPk: jest.fn(async (id) => tenants.find((t) => t.id === id) || null),
    // Only the `where` shapes tenant.service uses: { code|name, id: { [Op.ne]: x } }.
    findOne: jest.fn(async ({ where = {} } = {}) => {
      const excluded = where.id && Object.getOwnPropertySymbols(where.id).length
        ? where.id[Object.getOwnPropertySymbols(where.id)[0]]
        : undefined;
      return (
        tenants.find(
          (t) =>
            t.id !== excluded &&
            (where.code === undefined || t.code === where.code) &&
            (where.name === undefined || t.name === where.name),
        ) || null
      );
    }),
  };

  const Users = {
    findByPk: jest.fn(async (id) => {
      for (const p of principals.values()) {
        if (p.id === id) {
          return { id: p.id, tenantId: p.tenantId };
        }
      }
      return null;
    }),
  };

  const transaction = async () => {
    const tx = {
      finished: undefined,
      async commit() {
        if (tx.finished) {throw new Error("Transaction already finished");}
        pending.delete(tx);
        tx.finished = "commit";
      },
      async rollback() {
        if (tx.finished) {throw new Error("Transaction already finished");}
        // Undo newest-first, so two updates to one field restore the oldest.
        for (const [row, prior] of pending.get(tx).reverse()) {
          Object.assign(row, prior);
        }
        pending.delete(tx);
        tx.finished = "rollback";
      },
    };
    pending.set(tx, []);
    return tx;
  };

  return {
    tenantA,
    tenantB,
    principal,
    superAdmin,
    Tenants,
    Users,
    transaction,
    snapshot,
  };
};

module.exports = { createTwoTenants, TENANT_A_ID, TENANT_B_ID };
