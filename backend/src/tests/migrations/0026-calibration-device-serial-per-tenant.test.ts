/**
 * Migration 0026 — calibration_devices.serial_number unique per tenant (D-04).
 *
 * Runs the migration against a fake QueryInterface over an in-memory index
 * list. It proves the LOGIC: the global uniqueness is dropped under whatever
 * name it has, the composite is added, duplicates refuse the run before any
 * DDL, it is idempotent and reversible, and failures propagate.
 *
 * The SQL was run against pgvector/pgvector:pg18 (18.6) over a table built by
 * the PRE-change model's sync(): before — tenant B registering tenant A's
 * serial failed (the oracle); after — it succeeds, an in-tenant duplicate
 * still fails, NULL serials stay distinct, a second `up` changes nothing,
 * `down` refuses while a serial is shared across tenants, and `up` refuses
 * over an in-tenant duplicate naming it.
 *
 * P9-23: 0026 is TypeScript now (its recorded name is still
 * "0026-calibration-device-serial-per-tenant.js"); this suite reads the .ts source.
 */
/* eslint-disable @typescript-eslint/require-await -- the fakes stand in for the async QueryInterface: a throw inside them must be a rejection */
import * as fs from "fs";
import * as path from "path";
import { Sequelize, DataTypes } from "sequelize";

import migration from "../../migrations/0026-calibration-device-serial-per-tenant";
import defineCalibrationDevice from "../../models/calibrationDevice.model";

type Context = Parameters<typeof migration.up>[0]["context"];
const ctx = (qi: object): Context => qi as Context;

interface IndexDdl {
  table: string;
  fields: string[];
  options: { name: string; unique?: boolean };
}

const SOURCE = fs.readFileSync(
  path.join(__dirname, "../../migrations/0026-calibration-device-serial-per-tenant.ts"),
  "utf8",
);
const MANIFEST = fs.readFileSync(path.join(__dirname, "../../config/migrator.js"), "utf8");

/** The REAL model on an unconnected PostgreSQL-dialect Sequelize. */
const CalibrationDevice = defineCalibrationDevice(
  new Sequelize({ dialect: "postgres", logging: false }),
  DataTypes,
);

const COMPOSITE = "calibration_devices_tenant_id_serial_number_unique";

const fakeQueryInterface = ({
  tables = ["calibration_devices"],
  constraints = ["calibration_devices_serial_number_key"],
  indexes = ["calibration_devices_pkey", "calibration_devices_serial_number"],
  duplicates = [],
  crossTenant = [],
}: {
  tables?: (string | { tableName: string })[];
  constraints?: string[];
  indexes?: string[];
  duplicates?: { tenant_id: string; serial: string; copies: number }[];
  crossTenant?: { serial: string; tenants: number }[];
} = {}) => {
  const state = {
    constraints: new Set(constraints),
    indexes: new Set(indexes),
    ddl: [] as (string | IndexDdl)[],
  };
  const qi = {
    state,
    showAllTables: jest.fn(async () => tables),
    showIndex: jest.fn(async () => [...state.indexes, ...state.constraints].map((name) => ({ name }))),
    removeConstraint: jest.fn(async (_table: string, name: string) => {
      state.constraints.delete(name);
      state.ddl.push(`removeConstraint ${name}`);
    }),
    removeIndex: jest.fn(async (_table: string, name: string) => {
      state.indexes.delete(name);
      state.ddl.push(`removeIndex ${name}`);
    }),
    addIndex: jest.fn(async (table: string, fields: string[], options: { name: string; unique?: boolean }) => {
      state.indexes.add(options.name);
      state.ddl.push({ table, fields, options });
    }),
    sequelize: {
      query: jest.fn(async (sql: string): Promise<[unknown[]]> => {
        if (sql.includes("FROM pg_index")) {
          const globals = [
            ...[...state.constraints].map((n) => ({ index_name: n, constraint_name: n })),
            ...[...state.indexes]
              .filter((n) => n === "calibration_devices_serial_number")
              .map((n) => ({ index_name: n, constraint_name: null })),
          ];
          return [globals];
        }
        if (sql.includes("COUNT(DISTINCT tenant_id)")) {
          return [crossTenant];
        }
        if (sql.includes("GROUP BY tenant_id, serial_number")) {
          return [duplicates];
        }
        throw new Error(`unexpected SQL: ${sql}`);
      }),
    },
  };
  return qi;
};

const failure = async (promise: Promise<void>): Promise<Error> => (await promise.catch((e: unknown) => e)) as Error;

describe("migration 0026 — calibration device serial number per tenant (D-04)", () => {
  it("is registered in the static manifest under its frozen .js name", () => {
    expect(MANIFEST).toContain(
      '["0026-calibration-device-serial-per-tenant.js", require("../migrations/0026-calibration-device-serial-per-tenant")]',
    );
  });

  it("the model no longer declares a global unique on serialNumber (sync() would recreate the oracle)", () => {
    const serialNumber = (CalibrationDevice.getAttributes() as Record<string, { unique?: unknown }>)["serialNumber"];
    expect((serialNumber as { unique?: unknown }).unique).toBeFalsy();
    const indexes = CalibrationDevice.options.indexes as { unique?: boolean; fields: unknown[] }[] | undefined;
    const uniques = (indexes ?? []).filter((i) => i.unique);
    expect(uniques.filter((i) => i.fields.includes("serial_number"))).toEqual([]);
  });

  it("drops the global constraint AND the global index, then adds UNIQUE (tenant_id, serial_number)", async () => {
    const qi = fakeQueryInterface();

    await migration.up({ context: ctx(qi) });

    expect(qi.state.ddl).toEqual([
      "removeConstraint calibration_devices_serial_number_key",
      "removeIndex calibration_devices_serial_number",
      {
        table: "calibration_devices",
        fields: ["tenant_id", "serial_number"],
        options: { name: COMPOSITE, unique: true },
      },
    ]);
  });

  it("REFUSES on a serial repeated within a tenant, naming it, before any DDL", async () => {
    const qi = fakeQueryInterface({
      duplicates: [{ tenant_id: "t-1", serial: "SN-9", copies: 2 }],
    });

    const err = await failure(migration.up({ context: ctx(qi) }));

    expect(err.message).toMatch(/Migration 0026 refused: 1 serial number/);
    expect(err.message).toContain("serial_number = 'SN-9' ×2 in tenant t-1");
    expect(qi.state.ddl).toEqual([]);
  });

  it("summarises a long duplicate list", async () => {
    const many = Array.from({ length: 22 }, (_, i) => ({ tenant_id: "t-1", serial: `SN-${String(i)}`, copies: 2 }));
    const qi = fakeQueryInterface({ duplicates: many });

    const err = await failure(migration.up({ context: ctx(qi) }));

    expect(err.message).toContain("… and 2 more");
    expect(err.message.match(/×2 in tenant/g)).toHaveLength(20);
  });

  it("up is idempotent — a second run changes nothing", async () => {
    const qi = fakeQueryInterface();
    await migration.up({ context: ctx(qi) });
    const after = qi.state.ddl.length;

    await migration.up({ context: ctx(qi) });

    expect(qi.state.ddl).toHaveLength(after);
  });

  it("a table db.sync() has not created yet is skipped", async () => {
    const qi = fakeQueryInterface({ tables: [{ tableName: "Tenants" }] });

    await migration.up({ context: ctx(qi) });
    await migration.down({ context: ctx(qi) });

    expect(qi.sequelize.query).not.toHaveBeenCalled();
    expect(qi.state.ddl).toEqual([]);
  });

  it("any failure propagates — Umzug must not record it as applied", async () => {
    const qi = fakeQueryInterface();
    qi.addIndex.mockRejectedValueOnce(new Error("could not create unique index"));

    await expect(migration.up({ context: ctx(qi) })).rejects.toThrow("could not create unique index");
    expect(SOURCE).not.toMatch(/\bcatch\s*[({]/);
  });

  it("down restores the global index when no serial is shared across tenants", async () => {
    const qi = fakeQueryInterface();
    await migration.up({ context: ctx(qi) });

    await migration.down({ context: ctx(qi) });

    expect(qi.state.indexes.has(COMPOSITE)).toBe(false);
    expect(qi.state.ddl.at(-1)).toEqual({
      table: "calibration_devices",
      fields: ["serial_number"],
      options: { name: "calibration_devices_serial_number", unique: true },
    });

    // idempotent
    qi.addIndex.mockClear();
    qi.removeIndex.mockClear();
    await migration.down({ context: ctx(qi) });
    expect(qi.addIndex).not.toHaveBeenCalled();
    expect(qi.removeIndex).not.toHaveBeenCalled();
  });

  it("down REFUSES while a serial is held by more than one tenant", async () => {
    const qi = fakeQueryInterface({ crossTenant: [{ serial: "SN-1", tenants: 2 }] });

    await expect(migration.down({ context: ctx(qi) })).rejects.toThrow(/down refused: 1 serial number/);
    expect(qi.state.ddl).toEqual([]);
  });
});
