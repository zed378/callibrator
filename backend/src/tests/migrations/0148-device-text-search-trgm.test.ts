/**
 * Migration 0148 — the device register's trigram GIN. Pins what it ISSUES, without a database; the plan
 * (a Bitmap Index Scan on the index for a rare term) was measured on PostgreSQL 18 over the P24-05 volume
 * (the migration's header and its record).
 */
import * as fs from "fs";
import * as path from "path";
import m0148 from "../../migrations/0148-device-text-search-trgm";

const fakeContext = (valid: boolean | null) => {
  const calls: string[] = [];
  const sequelize = {
    query: jest.fn((sql: string) => {
      calls.push(sql.replace(/\s+/g, " ").trim());
      return Promise.resolve([sql.includes("FROM pg_index") && valid !== null ? [{ valid }] : [], null]);
    }),
  };
  return { context: { sequelize } as unknown as Parameters<typeof m0148.up>[0]["context"], calls };
};

const CREATE =
  "CREATE INDEX CONCURRENTLY \"calibration_devices_tenant_id_text_trgm\" ON calibration_devices " +
  "USING gin (tenant_id, name gin_trgm_ops, serial_number gin_trgm_ops, manufacturer gin_trgm_ops)";

describe("0148", () => {
  it("up creates both extensions, then the one tenant-led trigram index, concurrently", async () => {
    const { context, calls } = fakeContext(null);
    await m0148.up({ context });
    expect(calls.filter((s) => !s.includes("FROM pg_index"))).toEqual(["CREATE EXTENSION IF NOT EXISTS pg_trgm", "CREATE EXTENSION IF NOT EXISTS btree_gin", CREATE]);
  });

  it("a valid index is kept; an INVALID one (an interrupted build) is dropped and rebuilt", async () => {
    const kept = fakeContext(true);
    await m0148.up({ context: kept.context });
    expect(kept.calls.some((s) => s.startsWith("CREATE INDEX") || s.startsWith("DROP"))).toBe(false);
    const rebuilt = fakeContext(false);
    await m0148.up({ context: rebuilt.context });
    expect(rebuilt.calls.slice(-2)).toEqual(['DROP INDEX CONCURRENTLY IF EXISTS "calibration_devices_tenant_id_text_trgm"', CREATE]);
  });

  it("down drops the index and keeps the extensions", async () => {
    const { context, calls } = fakeContext(true);
    await m0148.down({ context });
    expect(calls).toEqual(['DROP INDEX CONCURRENTLY IF EXISTS "calibration_devices_tenant_id_text_trgm"']);
  });

  it("is registered right after 0147, has no try/catch, and no model declares the index", () => {
    const manifest = fs.readFileSync(path.join(__dirname, "../../config/migrator.ts"), "utf8");
    const names = [...manifest.matchAll(/\["(\d{4}-[\w.-]+\.js)"/g)].map((m) => m[1]);
    expect(names.indexOf("0148-device-text-search-trgm.js")).toBe(names.indexOf("0147-upstream-transform-maintain.js") + 1);
    expect(fs.readFileSync(path.join(__dirname, "../../migrations/0148-device-text-search-trgm.ts"), "utf8")).not.toMatch(/\btry\s*\{/);
    expect(fs.readFileSync(path.join(__dirname, "../../models/calibrationDevice.model.ts"), "utf8")).not.toMatch(/trgm/);
  });
});
