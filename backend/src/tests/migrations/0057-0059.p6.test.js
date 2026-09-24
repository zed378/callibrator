/**
 * Migrations 0057 (P6-03), 0058 (P6-10 / S-08), 0059 (P6-09) — the parts that
 * need no database: that each is in the static manifest (the compiled binary
 * runs nothing else — config/migrator.js), in order, and the guards that run
 * before any SQL.
 *
 * The SQL itself runs against PostgreSQL in
 *   services/dataIntegrity.p6.live.test.js  (0057, 0059: up, re-run, down, the trigger, the grants)
 *   services/keyRotation.s08.live.test.js   (0058: up, re-run, refusal, down)
 * which are opt-in (DATA_PG_LIVE_TEST=1) and were run on PostgreSQL 16.
 */
const fs = require("fs");
const path = require("path");

const MANIFEST = fs.readFileSync(path.join(__dirname, "../../config/migrator.js"), "utf8");
const m0057 = require("../../migrations/0057-calibration-records-append-only");
const m0058 = require("../../migrations/0058-tenant-keys-kms-envelope");
const m0059 = require("../../migrations/0059-stock-adjustment-reason-and-item");

describe("migrations 0057–0059", () => {
  it("are all in the static manifest, in order", () => {
    const names = [
      "0057-calibration-records-append-only",
      "0058-tenant-keys-kms-envelope",
      "0059-stock-adjustment-reason-and-item",
    ];
    const at = names.map((n) => MANIFEST.indexOf(`["${n}.js", require("../migrations/${n}")]`));
    expect(at.every((i) => i > 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it("each exports up and down", () => {
    for (const m of [m0057, m0058, m0059]) {
      expect(typeof m.up).toBe("function");
      expect(typeof m.down).toBe("function");
    }
  });

  describe("0057 — the application role name", () => {
    it.each([[undefined], [""], ["none"]])("%p means the default role", (raw) => {
      expect(m0057.appRoleName(raw)).toBe("callibrator_app");
    });

    it("a plain identifier is used as given", () => {
      expect(m0057.appRoleName("callibrator_app2")).toBe("callibrator_app2");
    });

    it.each([["App"], ["x; DROP TABLE users"], ['"q"']])("refuses %p rather than interpolating it", (raw) => {
      expect(() => m0057.appRoleName(raw)).toThrow(/not a plain lower-case identifier/);
    });

    it("the lifecycle columns — the only UPDATE the role keeps — carry no content", () => {
      expect([...m0057.LIFECYCLE_COLUMNS].sort()).toEqual(
        ["deleted_at", "is_deleted", "superseded_at", "superseded_by_id", "updated_at", "void_reason", "voided_by"],
      );
    });
  });

  it("0057 and 0059 THROW rather than skip when their table is absent (a skip is recorded as applied — PR-5)", async () => {
    const context = {
      sequelize: {
        transaction: async (work) => work("tx"),
        query: jest.fn(async (sql) => {
          if (sql.includes("to_regclass")) {
            return [[{ present: false }]];
          }
          if (sql.includes("information_schema.columns")) {
            return [[]];
          }
          return [[]];
        }),
      },
    };
    await expect(m0057.up({ context })).rejects.toThrow(/table calibration_records does not exist/);
    await expect(m0059.up({ context })).rejects.toThrow(/table stock_adjustments does not exist/);
  });

  it("0058 has nothing to convert when tenant_keys is absent, and says nothing", async () => {
    const query = jest.fn(async () => [[{ present: false }]]);
    await expect(m0058.up({ context: { sequelize: { query } } })).resolves.toBeUndefined();
    await expect(m0058.down({ context: { sequelize: { query } } })).resolves.toBeUndefined();
    expect(query).toHaveBeenCalledTimes(2);
  });
});
