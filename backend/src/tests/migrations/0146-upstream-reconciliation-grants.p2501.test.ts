/**
 * Migration 0146 — the reconciliation's two read grants to the transform role (P25-01, P25-02;
 * ADR-129 Am. 11). Pins what it ISSUES, without a database; the grants are proved AS the transform
 * role in upstreamTransform.p2402g.live ("P25-01/P25-02 on the IPM world").
 */
import * as fs from "fs";
import * as path from "path";
import m0146 from "../../migrations/0146-upstream-reconciliation-grants";
import { environment } from "../../config/env";

const penv = environment();

const fakeContext = (world: { tables?: string[]; transformRole?: boolean } = {}) => {
  const tables = world.tables ?? ["calibration_records", "calibration_devices"];
  const calls: string[] = [];
  const yes = (v: boolean) => Promise.resolve([[{ yes: v }], null]);
  const sequelize = {
    query: jest.fn((sql: string) => {
      calls.push(sql);
      const regclass = /to_regclass\('([\w.]+)'\)/.exec(sql);
      if (regclass) {
        return yes(tables.includes(regclass[1] as string));
      }
      if (sql.includes("FROM pg_roles WHERE rolname")) {
        return yes(world.transformRole ?? true);
      }
      return Promise.resolve([[], null]);
    }),
    transaction: jest.fn((fn: (t: object) => Promise<void>) => fn({})),
  };
  return { context: { sequelize } as unknown as Parameters<typeof m0146.up>[0]["context"], calls };
};

afterEach(() => {
  delete penv["UPSTREAM_TRANSFORM_DB_ROLE"];
});

describe("0146", () => {
  it("up grants SELECT on exactly two columns, nothing written; down revokes the same two", async () => {
    const up = fakeContext();
    await m0146.up({ context: up.context });
    expect(up.calls[0]).toBe("SET LOCAL lock_timeout = '10s'");
    expect(up.calls.filter((s) => s.startsWith("GRANT "))).toEqual([
      "GRANT SELECT (client_facility_id) ON calibration_records TO callibrator_transform",
      "GRANT SELECT (inventoried_on) ON calibration_devices TO callibrator_transform",
    ]);
    const down = fakeContext();
    await m0146.down({ context: down.context });
    expect(down.calls.filter((s) => s.startsWith("REVOKE "))).toEqual([
      "REVOKE SELECT (client_facility_id) ON calibration_records FROM callibrator_transform",
      "REVOKE SELECT (inventoried_on) ON calibration_devices FROM callibrator_transform",
    ]);
  });

  it.each(["calibration_records", "calibration_devices"])("refuses (never skips) without %s", async (missing) => {
    await expect(m0146.up({ context: fakeContext({ tables: ["calibration_records", "calibration_devices"].filter((t) => t !== missing) }).context })).rejects.toThrow(
      `0146: table ${missing} does not exist`,
    );
  });

  it("refuses without the transform role; the role name comes from the environment", async () => {
    await expect(m0146.up({ context: fakeContext({ transformRole: false }).context })).rejects.toThrow('the transform role "callibrator_transform" does not exist');
    penv["UPSTREAM_TRANSFORM_DB_ROLE"] = "etl_transform";
    const { context, calls } = fakeContext();
    await m0146.up({ context });
    expect(calls).toContain("GRANT SELECT (inventoried_on) ON calibration_devices TO etl_transform");
  });

  it("is registered right after 0145, and has no try/catch", () => {
    const manifest = fs.readFileSync(path.join(__dirname, "../../config/migrator.ts"), "utf8");
    const names = [...manifest.matchAll(/\["(\d{4}-[\w.-]+\.js)"/g)].map((m) => m[1]);
    expect(names.indexOf("0146-upstream-reconciliation-grants.js")).toBe(names.indexOf("0145-upstream-transform-attachments.js") + 1);
    expect(fs.readFileSync(path.join(__dirname, "../../migrations/0146-upstream-reconciliation-grants.ts"), "utf8")).not.toMatch(/\btry\s*\{/);
  });
});
