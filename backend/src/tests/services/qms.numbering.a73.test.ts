/**
 * A-73 — NC and CAPA numbers cannot collide.
 *
 * The number used to be `count() + 1`, read inside the create's transaction.
 * Under READ COMMITTED (PostgreSQL's default) a transaction does not see
 * another's uncommitted insert, so two concurrent creates both read the same
 * count and both issued the same number.
 *
 * `fakePg` below models the three PostgreSQL behaviours the fix depends on,
 * and nothing else:
 *   - a read sees only COMMITTED rows (READ COMMITTED);
 *   - `INSERT ... ON CONFLICT (tenant_id, kind) DO UPDATE` on qms_counters
 *     takes the counter row's lock and holds it until COMMIT/ROLLBACK; a
 *     second claimant waits, then reads the committed value;
 *   - the composite unique index (tenant_id, <number>) from migration 0024
 *     refuses a second commit of the same number in a tenant.
 * It is a model of the database, so it proves the service's protocol, not the
 * database. The same scenario was run against pgvector/pgvector:pg18 with the
 * real service (50 concurrent creates across two tenants: distinct numbers,
 * zero failures — see the A-73 record).
 */

const mockPg: any = { current: null };

const fakePg = () => {
  const committed: any = { non_conformances: [], capas: [] };
  const counters = new Map();
  const locks = new Map(); // counter key -> { holder, waiters[] }
  const sql: any[] = [];

  const release = (tx: any) => {
    for (const key of tx.locks) {
      const lock = locks.get(key);
      lock.holder = null;
      const next = lock.waiters.shift();
      if (next) {next();}
    }
    tx.locks = [];
  };

  const acquire = async (key: any, tx: any) => {
    if (!locks.has(key)) {locks.set(key, { holder: null, waiters: [] });}
    const lock = locks.get(key);
    while (lock.holder && lock.holder !== tx) {
      await new Promise((resolve: any) => lock.waiters.push(resolve));
    }
    if (lock.holder !== tx) {
      lock.holder = tx;
      tx.locks.push(key);
    }
  };

  const numberColumn: any = { non_conformances: "ncNumber", capas: "capaNumber" };

  const pg: any = {
    committed,
    counters,
    sql,
    async transaction(cb: any) {
      const tx: any = { staged: [], counters: new Map(), locks: [] };
      try {
        const result = await cb(tx);
        // COMMIT: the unique index (tenant_id, number) is checked here.
        for (const { table, row } of tx.staged) {
          const col = numberColumn[table];
          if (committed[table].some((r: any) => r.tenantId === row.tenantId && r[col] === row[col])) {
            const err = new Error(`duplicate key value violates unique constraint "${table}_tenant_id_${col}_unique"`);
            err.name = "SequelizeUniqueConstraintError";
            throw err;
          }
          committed[table].push(row);
        }
        for (const [key, seq] of tx.counters) {counters.set(key, seq);}
        release(tx);
        return result;
      } catch (error: any) {
        release(tx); // ROLLBACK: staged rows and counter increments vanish
        throw error;
      }
    },
    /** The counter upsert. Asserts the statement has the shape these semantics assume. */
    // P9-07: the claim runs through sql() — bind [$1 tenant, $2 kind, $3 pattern], type SELECT.
    async query(text: any, { bind, type, transaction }: any) {
      sql.push(text);
      expect(text).toMatch(/INSERT INTO qms_counters/);
      expect(text).toMatch(/ON CONFLICT \(tenant_id, kind\)/);
      expect(text).toMatch(/WHERE tenant_id = \$1/);
      expect(type).toBe("SELECT");
      expect(transaction).toBeDefined();
      const [tenantId, kind, pattern] = bind;
      const key = `${tenantId}:${kind}`;
      await acquire(key, transaction);
      // Seed: the highest number already issued in the tenant (committed).
      const table = kind === "NC" ? "non_conformances" : "capas";
      const re = new RegExp(pattern);
      const seed =
      Math.max(
        0,
        ...committed[table].
        filter((r: any) => r.tenantId === tenantId).
        map((r: any) => {
          const m = String(r[numberColumn[table]]).match(re);
          return m ? Number(m[1]) : 0;
        })
      ) + 1;
      const current = transaction.counters.has(key) ? transaction.counters.get(key) : counters.get(key);
      const seq = current === undefined ? seed : Math.max(current + 1, seed);
      transaction.counters.set(key, seq);
      return [{ seq }];
    },
    model(table: any) {
      return {
        // READ COMMITTED: only committed rows are counted. Yields first, as a
        // round-trip to the database does.
        count: jest.fn(async ({ where }: any) => {
          await new Promise((resolve: any) => setImmediate(resolve));
          return committed[table].filter((r: any) => r.tenantId === where.tenantId).length;
        }),
        create: jest.fn(async (values: any, { transaction }: any) => {
          await new Promise((resolve: any) => setImmediate(resolve));
          const row: any = { id: `${table}-${Math.random().toString(16).slice(2)}`, ...values };
          transaction.staged.push({ table, row });
          return row;
        }),
        findOne: jest.fn(async ({ where }: any) => ({ id: where.id, tenantId: where.tenantId, ncNumber: "NC-00001" }))
      };
    }
  };
  return pg;
};

jest.mock("../../models", () => ({
  NonConformance: new Proxy({}, { get: (_t: any, k: any) => mockPg.current.models.NonConformance[k] }),
  Capa: new Proxy({}, { get: (_t: any, k: any) => mockPg.current.models.Capa[k] }),
  User: { findOne: async ({ where }: any) => ({ id: where.id }) },
  CalibrationDevice: { findOne: async ({ where }: any) => ({ id: where.id }) }
}));
jest.mock("../../config", () => ({
  db: {
    transaction: (...args: any[]) => mockPg.current.transaction(...args),
    query: (...args: any[]) => mockPg.current.query(...args)
  }
}));
jest.mock("../../services/audit.service", () => ({ logAction: jest.fn(async () => ({})) }));

const service = require("../../services/qms.service");
const auditService = require("../../services/audit.service");

const TENANT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TENANT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

beforeEach(() => {
  const pg = fakePg();
  pg.models = { NonConformance: pg.model("non_conformances"), Capa: pg.model("capas") };
  mockPg.current = pg;
});

const createNC = (tenantId: any, title: any) => service.createNC(tenantId, "user-1", { title, description: "d" });
const numbers = (table: any, tenantId: any, col: any) =>
mockPg.current.committed[table].filter((r: any) => r.tenantId === tenantId).map((r: any) => r[col]).sort();

describe("A-73 — per-tenant QMS numbering under concurrency", () => {
  it("two concurrent creates get distinct numbers", async () => {
    const results = await Promise.allSettled([createNC(TENANT_A, "first"), createNC(TENANT_A, "second")]);

    expect(results.map((r: any) => r.status)).toEqual(["fulfilled", "fulfilled"]);
    expect(numbers("non_conformances", TENANT_A, "ncNumber")).toEqual(["NC-00001", "NC-00002"]);
  });

  it("twenty concurrent NC creates and ten CAPA creates are all distinct and gap-free", async () => {
    await Promise.all(Array.from({ length: 20 }, (_: any, i: any) => createNC(TENANT_A, `nc ${i}`)));
    await Promise.all(
      Array.from({ length: 10 }, (_: any, i: any) =>
      service.createCapa(TENANT_A, { ncId: "nc-1", title: `capa ${i}`, actionPlan: "p" })
      )
    );

    expect(numbers("non_conformances", TENANT_A, "ncNumber")).toEqual(
      Array.from({ length: 20 }, (_: any, i: any) => `NC-${String(i + 1).padStart(5, "0")}`)
    );
    expect(numbers("capas", TENANT_A, "capaNumber")).toEqual(
      Array.from({ length: 10 }, (_: any, i: any) => `CAPA-${String(i + 1).padStart(5, "0")}`)
    );
  });

  it("each tenant numbers independently — the same number in two tenants is not a collision", async () => {
    await Promise.all([
    createNC(TENANT_A, "a1"),
    createNC(TENANT_B, "b1"),
    createNC(TENANT_A, "a2"),
    createNC(TENANT_B, "b2")]
    );

    expect(numbers("non_conformances", TENANT_A, "ncNumber")).toEqual(["NC-00001", "NC-00002"]);
    expect(numbers("non_conformances", TENANT_B, "ncNumber")).toEqual(["NC-00001", "NC-00002"]);
    // The claim is keyed by the caller's tenant — never by a body value.
    expect(mockPg.current.counters.get(`${TENANT_A}:NC`)).toBe(2);
    expect(mockPg.current.counters.get(`${TENANT_B}:NC`)).toBe(2);
  });

  it("a rolled-back create does not consume its number", async () => {
    auditService.logAction.mockRejectedValueOnce(new Error("audit insert failed"));

    await expect(createNC(TENANT_A, "fails")).rejects.toThrow("audit insert failed");
    await createNC(TENANT_A, "succeeds");

    expect(numbers("non_conformances", TENANT_A, "ncNumber")).toEqual(["NC-00001"]);
  });

  it("numbering continues above numbers already issued (the counter seeds from existing rows)", async () => {
    mockPg.current.committed.non_conformances.push(
      { tenantId: TENANT_A, ncNumber: "NC-00041" },
      { tenantId: TENANT_A, ncNumber: "legacy-7" },
      { tenantId: TENANT_B, ncNumber: "NC-00900" }
    );

    await createNC(TENANT_A, "next");

    expect(numbers("non_conformances", TENANT_A, "ncNumber")).toContain("NC-00042");
  });
});