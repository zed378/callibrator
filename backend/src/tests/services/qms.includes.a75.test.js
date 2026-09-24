/**
 * A-75 — what the QMS list queries actually send to PostgreSQL.
 *
 * Measured, not assumed: the REAL models barrel (every model, every
 * association, the REAL global tenant hooks from utils/tenantScope.util.js) on
 * an UNCONNECTED PostgreSQL-dialect Sequelize, with `sequelize.query` replaced
 * by a recorder. The SQL asserted on is exactly the SQL Sequelize generates for
 * a request running in a tenant context. It proves the statement; that the
 * statement returns no foreign row was checked against pgvector/pgvector:pg18
 * (see the A-75 record).
 *
 * Two findings this file pins, both codebase-wide:
 *
 *  1. (Fixed by A-87 — kept as history.) The global tenant hooks put the
 *     tenant predicate on the ROOT model's WHERE only. `beforeFind` fires once, for the model `findAll` was called
 *     on; an include gets no tenant predicate from the hooks. Any include of a
 *     tenant-scoped model reaches every tenant's rows unless the query says
 *     otherwise.
 *  2. An include of a model with a `defaultScope` `where` (User,
 *     CalibrationDevice: `is_deleted = false`) is an INNER JOIN unless it says
 *     `required: false` — the scope's `where` makes Sequelize default the
 *     include to required. That is the CLAUDE.md "optional include" trap, and
 *     it fires even when the include itself names no `where`.
 */

const mockSql = { statements: [] };

jest.mock("../../config", () => {
  const { Sequelize } = jest.requireActual("sequelize");
  const db = new Sequelize({ dialect: "postgres", logging: false });
  db.query = async (sql) => {
    const text = typeof sql === "string" ? sql : sql.query;
    mockSql.statements.push(text);
    // count() reads { count }; a row SELECT reads an array.
    return /^SELECT count\(/i.test(text) ? { count: 1 } : [];
  };
  return { db };
});
jest.mock("../../services/audit.service", () => ({ logAction: jest.fn() }));

const models = require("../../models");
const qmsService = require("../../services/qms.service");
const { tenantStorage } = require("../../middlewares/tenantContext.middleware");

const TENANT = "11111111-1111-4111-8111-111111111111";

/** Run `fn` as a request of TENANT — the context the hooks read. */
const asTenant = (fn) => tenantStorage.run({ tenantId: TENANT }, fn);

/** The last row SELECT (not the count) recorded. */
const lastSelect = () =>
  [...mockSql.statements].reverse().find((s) => /^SELECT (?!count\()/i.test(s));

/**
 * The JOIN clause for one include alias: its join type and its ON condition.
 * @returns {{ type: string, on: string }}
 */
const join = (sql, table, alias) => {
  const re = new RegExp(
    `(LEFT OUTER|INNER) JOIN "${table}" AS "${alias}" ON (.*?)(?= LEFT OUTER JOIN | INNER JOIN | WHERE |;|$)`,
  );
  const match = sql.match(re);
  if (!match) {throw new Error(`no join for ${alias} in: ${sql}`);}
  return { type: match[1], on: match[2] };
};

beforeEach(() => {
  mockSql.statements = [];
});

describe("A-75 — the tenant hooks and includes (codebase-wide finding)", () => {
  // A-87 closed finding 1 at the mechanism: the hooks now walk the include
  // tree (utils/tenantScope.util.js, applyTenantToIncludes). This test pinned
  // the leak; it now pins the fix. The data-driven proof over every
  // association is tests/utils/tenantScope.includes.a87.test.js.
  it("global tenant hooks add the predicate to the root WHERE and to a tenant-scoped include (A-87)", async () => {
    await asTenant(() =>
      models.NonConformance.findAll({
        include: [{ model: models.CalibrationDevice, as: "device", required: false }],
      }),
    );
    const sql = lastSelect();

    expect(sql).toMatch(new RegExp(`WHERE .*"NonConformance"."tenant_id" = '${TENANT}'`));
    const device = join(sql, "calibration_devices", "device");
    expect(device.on).toContain(`"device"."tenant_id" = '${TENANT}'`);
    expect(device.type).toBe("LEFT OUTER");
  });

  it("an include of a defaultScoped model without required:false is an INNER JOIN", async () => {
    await asTenant(() =>
      models.NonConformance.findAll({
        include: [{ model: models.CalibrationDevice, as: "device" }],
      }),
    );

    expect(join(lastSelect(), "calibration_devices", "device").type).toBe("INNER");
  });
});

describe("A-75 — the QMS list queries", () => {
  it("both QMS includes are required:false — every join is LEFT OUTER and carries the tenant", async () => {
    await asTenant(() => qmsService.getNCs(TENANT, 1, 10));
    const ncSql = lastSelect();
    await asTenant(() => qmsService.getCapas(TENANT, 1, 10));
    const capaSql = lastSelect();

    const joins = {
      "NC reporter": join(ncSql, "users", "reporter"),
      "NC device": join(ncSql, "calibration_devices", "device"),
      "CAPA nonConformance": join(capaSql, "non_conformances", "nonConformance"),
      "CAPA assignee": join(capaSql, "users", "assignee"),
    };
    for (const [name, { type, on }] of Object.entries(joins)) {
      // An NC with no device (device_id is nullable) and a CAPA with no
      // assignee stay in the list...
      expect({ name, type }).toEqual({ name, type: "LEFT OUTER" });
      // ...and a reference to another tenant's row joins nothing, so none of
      // its columns can be returned.
      const alias = on.match(/"(\w+)"\."tenant_id"/);
      expect({ name, tenantInOn: on.includes(`."tenant_id" = '${TENANT}'`) }).toEqual({
        name,
        tenantInOn: true,
      });
      expect(alias && alias[1]).not.toMatch(/^(NonConformance|Capa)$/);
    }
    expect(ncSql).not.toMatch(/INNER JOIN/);
    expect(capaSql).not.toMatch(/INNER JOIN/);
  });

  it("the include predicate is the tenant argument even with no request context (system work)", async () => {
    await qmsService.getNCs(TENANT, 1, 10);

    expect(join(lastSelect(), "calibration_devices", "device").on).toContain(
      `"device"."tenant_id" = '${TENANT}'`,
    );
  });
});
