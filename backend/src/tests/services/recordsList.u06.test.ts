/**
 * U-06 (ADR-119) — the calibration-record list counts the records alone and
 * joins only the page.
 *
 * Before: `findAndCountAll` carried the three LEFT includes into the COUNT,
 * and the page query joined every row it skipped (page 200: 2,000 rows joined
 * to their device and performer, 1,990 thrown away — 6,592 buffers on the
 * P8-07 volume; 622 after). The SQL below is what the REAL models, the REAL
 * tenant hooks and the REAL service generate; only the database is a double
 * (as includes.a90 does it).
 *
 * The identity of the two shapes on PostgreSQL 18 (8 cases: pages 1, 200 and
 * past the end, each filter, includeSuperseded, a device with no records —
 * the same rows, order, joined relations and meta) is in the U-06 record.
 */
import type * as SequelizeModule from "sequelize";

const mockSql: { statements: string[] } = { statements: [] };

jest.mock("../../config", () => {
  const { Sequelize } = jest.requireActual<typeof SequelizeModule>("sequelize");
  const db = new Sequelize({ dialect: "postgres", logging: false });
  (db as unknown as { query: unknown }).query = (sql: string | { query: string }, options?: { plain?: boolean }) => {
    const text = typeof sql === "string" ? sql : sql.query;
    mockSql.statements.push(text);
    if (/^SELECT count\(/i.test(text)) {
      return Promise.resolve({ count: 3 });
    }
    return Promise.resolve(options?.plain ? null : []);
  };
  return { db };
});
jest.mock("../../services/audit.service", () => ({ logAction: jest.fn() }));
jest.mock("../../services/redis.service", () => ({
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue(undefined),
  del: jest.fn().mockResolvedValue(undefined),
  cacheKeys: { userPermissions: (id: string) => `user-perms:${id}` },
}));

/* eslint-disable @typescript-eslint/no-require-imports -- loaded after the mocks above, as includes.a90 does */
require("../../models");
const { tenantStorage } = require("../../middlewares/tenantContext.middleware") as {
  tenantStorage: { run<T>(store: object, fn: () => T): T };
};
const recordsService = require("../../services/calibrationRecords.service") as {
  fetchCalibrationRecords(q: Record<string, unknown>): Promise<{ data: { rows: unknown[]; count: number; meta: { total: number } } }>;
};
const models = require("../../models") as { CalibrationRecord: { findAll: (...a: unknown[]) => Promise<unknown[]> } };
/* eslint-enable @typescript-eslint/no-require-imports */

const TENANT = "11111111-1111-4111-8111-111111111111";

const asTenant = <T>(fn: () => T): T =>
  tenantStorage.run({ tenantId: TENANT, isSuperAdmin: false, isSystemTask: false }, fn);

const list = (query: Record<string, unknown> = {}): ReturnType<typeof recordsService.fetchCalibrationRecords> =>
  asTenant(() => recordsService.fetchCalibrationRecords({ tenantId: TENANT, ...query }));

beforeEach(() => {
  mockSql.statements = [];
});

afterEach(() => {
  jest.restoreAllMocks();
});

/** A column of the root model, as Sequelize quotes it. */
const col = (name: string): string => `"CalibrationRecord"."${name}"`;

const countOf = (): string => mockSql.statements.find((s) => /^SELECT count\(/i.test(s)) ?? "";
const pageOf = (): string => mockSql.statements.find((s) => !/^SELECT count\(/i.test(s)) ?? "";

describe("U-06 — the record list's count reads the records alone", () => {
  it("the count joins nothing and counts rows, with the page's WHERE (fail-before: three LEFT JOINs, count(id))", async () => {
    const result = await list({ page: 200, limit: 10 });
    expect(result.data.meta.total).toBe(3);

    const count = countOf();
    expect(count).toMatch(/^SELECT count\(\*\) AS "count" FROM "calibration_records" AS "CalibrationRecord" WHERE /);
    expect(count).not.toMatch(/JOIN/);
    // The tenant predicate and the live-record predicate are still there (the hooks add them).
    expect(count).toContain(`${col("tenant_id")} = '${TENANT}'`);
    expect(count).toContain(`${col("is_deleted")} = false`);
    expect(count).toContain(`${col("superseded_by_id")} IS NULL`);
    // …and they are exactly the page's: the WHERE inside the page's subquery.
    const where = /WHERE (.*)$/.exec(count.replace(/;$/, ""))?.[1] ?? "";
    expect(where).not.toBe("");
    expect(pageOf()).toContain(`WHERE ${where} ORDER BY`);
  });

  it("each filter reaches the count as it reaches the page", async () => {
    await list({ deviceId: "33333333-3333-4333-8333-333333333333", isCompliant: false, from: "2026-01-01", to: "2026-06-30", includeSuperseded: true });

    const count = countOf();
    for (const fragment of [
      `${col("device_id")} = '33333333-3333-4333-8333-333333333333'`,
      `${col("is_compliant")} = false`,
      `${col("calibration_date")} >= '`,
      `${col("calibration_date")} <= '`,
    ]) {
      expect(count).toContain(fragment);
    }
    expect(count).not.toContain("superseded_by_id");
    const where = /WHERE (.*)$/.exec(count.replace(/;$/, ""))?.[1] ?? "";
    expect(pageOf()).toContain(`WHERE ${where} ORDER BY`);
  });
});

describe("U-06 — the record list joins only the page", () => {
  it("LIMIT/OFFSET run inside a subquery over the records; the includes join outside it, still LEFT and tenant-scoped (fail-before: joined, then limited)", async () => {
    await list({ page: 200, limit: 10 });

    const page = pageOf();
    const inner = /FROM \(SELECT (.*?) LIMIT 10 OFFSET 1990\) AS "CalibrationRecord"/.exec(page);
    expect(inner).not.toBeNull();
    expect(inner?.[1]).not.toMatch(/JOIN/);
    expect(inner?.[1]).toContain(`ORDER BY ${col("calibration_date")} DESC`);
    const joins: readonly (readonly [string, string])[] = [
      ["calibration_devices", "device"],
      ["users", "performer"],
      ["api_keys", "apiKey"],
    ];
    for (const [table, alias] of joins) {
      expect(page).toMatch(new RegExp(`\\) AS "CalibrationRecord".* LEFT OUTER JOIN "${table}" AS "${alias}" ON [^]*?"${alias}"\\."tenant_id" = '${TENANT}'`));
    }
    expect(page).not.toMatch(/INNER JOIN/);
    expect(page).toMatch(/ORDER BY "calibrationDate" DESC, "CalibrationRecord"\."id" DESC;?$/);
  });

  it("no total, no rows: findAndCountAll's rule is kept", async () => {
    // The count double answers 3; a 0 total must empty the page whatever it read.
    jest.spyOn(models.CalibrationRecord, "findAll").mockResolvedValueOnce([{ id: "r1" }]);
    const { db } = jest.requireMock<{ db: { query: (sql: string, options?: object) => Promise<unknown> } }>("../../config");
    const realQuery = db.query;
    db.query = (sql: string, options?: object): Promise<unknown> =>
      /^SELECT count\(/i.test(sql) ? Promise.resolve({ count: 0 }) : realQuery(sql, options);

    try {
      const result = await list();
      expect(result.data.meta.total).toBe(0);
      expect(result.data.rows).toEqual([]);
    } finally {
      db.query = realQuery;
    }
  });
});
