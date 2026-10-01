/**
 * Migration 0089 — a retired calibration device stays retired (Q-02, ADR-084).
 *
 * Proves the LOGIC against a fake QueryInterface: what it issues, in one
 * transaction; that it refuses (throws) rather than skips when the table is
 * absent; that it has no try/catch; that it is registered and reversible. The
 * trigger itself — that it fires, for which updates, and that only the
 * transaction-local reinstatement setting gets past it — is proven on
 * PostgreSQL 18 by services/calibrationDevice.retired.q02.live.test.js, on a
 * fresh database and on an upgraded one.
 *
 * P9-23: 0089 is TypeScript now (its recorded name is still
 * "0089-calibration-device-retired-terminal.js"); this suite reads the .ts source.
 */
/* eslint-disable @typescript-eslint/require-await -- the fakes stand in for the async sequelize: a throw inside them must be a rejection */
import * as fs from "fs";
import * as path from "path";

import migration from "../../migrations/0089-calibration-device-retired-terminal";

type Context = Parameters<typeof migration.up>[0]["context"];
const ctx = (fake: object): Context => fake as Context;

interface QueryOptions {
  replacements?: unknown;
  transaction?: unknown;
}

const SOURCE = fs.readFileSync(
  path.join(__dirname, "../../migrations/0089-calibration-device-retired-terminal.ts"),
  "utf8",
);
const MANIFEST = fs.readFileSync(path.join(__dirname, "../../config/migrator.js"), "utf8");

const fakeQueryInterface = ({
  tableExists = true,
  failOn = null,
}: { tableExists?: boolean; failOn?: RegExp | null } = {}) => {
  const state = { statements: [] as string[], transactions: 0 };
  const sequelize = {
    query: jest.fn(async (sql: string, options: QueryOptions = {}) => {
      if (sql.includes("to_regclass")) {
        expect(options.replacements).toEqual({ table: "calibration_devices" });
        return [[{ reg: tableExists ? "calibration_devices" : null }]];
      }
      expect(options.transaction).toBeDefined();
      if (failOn?.test(sql)) {
        throw new Error("lock timeout");
      }
      state.statements.push(sql.replace(/\s+/g, " ").trim());
      return [[], null];
    }),
    transaction: jest.fn(async (work: (t: { id: string }) => Promise<unknown>) => {
      state.transactions += 1;
      return work({ id: `tx${String(state.transactions)}` });
    }),
  };
  return { state, sequelize };
};

describe("migration 0089 — calibration_devices: retired is terminal", () => {
  it("is registered in the static manifest under its frozen .js name", () => {
    expect(MANIFEST).toContain(
      '["0089-calibration-device-retired-terminal.js", require("../migrations/0089-calibration-device-retired-terminal")]',
    );
  });

  it("creates the function and a BEFORE UPDATE OF status trigger, in one transaction with a lock timeout", async () => {
    const qi = fakeQueryInterface();

    await migration.up({ context: ctx(qi) });

    expect(qi.state.transactions).toBe(1);
    const [lock, fn, drop, create] = qi.state.statements;
    expect(lock).toBe("SET LOCAL lock_timeout = '10s'");
    expect(fn).toMatch(/^CREATE OR REPLACE FUNCTION calibration_devices_retired_terminal\(\) RETURNS trigger/);
    expect(fn).toMatch(/OLD\.status::text = 'retired' AND NEW\.status::text IS DISTINCT FROM 'retired'/);
    expect(fn).toMatch(/current_setting\('callibrator\.reinstate_device', true\)/);
    expect(fn).toMatch(/USING ERRCODE = '23514'/);
    expect(fn).toMatch(/retirement is terminal/);
    expect(drop).toBe("DROP TRIGGER IF EXISTS calibration_devices_retired_terminal ON calibration_devices");
    expect(create).toBe(
      "CREATE TRIGGER calibration_devices_retired_terminal BEFORE UPDATE OF status ON calibration_devices FOR EACH ROW EXECUTE FUNCTION calibration_devices_retired_terminal()",
    );
  });

  it("refuses to run — and so to be recorded as applied — when the table is absent", async () => {
    const qi = fakeQueryInterface({ tableExists: false });

    await expect(migration.up({ context: ctx(qi) })).rejects.toThrow(/table calibration_devices does not exist/);
    expect(qi.state.statements).toEqual([]);
  });

  it("lets a failure propagate: nothing is swallowed", async () => {
    const qi = fakeQueryInterface({ failOn: /CREATE TRIGGER/ });

    await expect(migration.up({ context: ctx(qi) })).rejects.toThrow("lock timeout");
    expect(SOURCE).not.toMatch(/\btry\s*\{|\.catch\(/);
  });

  it("is idempotent: a second run replaces the function and the trigger", async () => {
    const qi = fakeQueryInterface();

    await migration.up({ context: ctx(qi) });
    await migration.up({ context: ctx(qi) });

    expect(qi.state.statements.filter((s) => s.startsWith("CREATE TRIGGER"))).toHaveLength(2);
    expect(qi.state.statements.filter((s) => s.startsWith("DROP TRIGGER IF EXISTS"))).toHaveLength(2);
  });

  it("down drops the trigger, then the function", async () => {
    const qi = fakeQueryInterface();

    await migration.down({ context: ctx(qi) });

    expect(qi.state.statements).toEqual([
      "DROP TRIGGER IF EXISTS calibration_devices_retired_terminal ON calibration_devices",
      "DROP FUNCTION IF EXISTS calibration_devices_retired_terminal()",
    ]);
  });

  it("names the setting the reinstatement service sets", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- the service is JavaScript (CommonJS)
    const service: unknown = require("../../services/calibrationDeviceReinstate.service");
    expect(migration.REINSTATE_SETTING).toBe("callibrator.reinstate_device");
    expect(service).toBeDefined();
  });
});
