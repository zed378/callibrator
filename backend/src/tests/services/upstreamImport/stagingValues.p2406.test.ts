/**
 * P24-06 — a MariaDB column's staging type, a dumped value's conversion for it
 * (services/upstreamImport/stagingValues.ts), and the extraction policy
 * (tablePolicy.ts, docs/UPSTREAM/07-DATA-MINIMISATION.md as code).
 *
 * The conversion is what keeps a staging batch from failing on a value: every
 * value PostgreSQL would refuse is refused HERE with a reason, and every value
 * accepted here is one PostgreSQL parses (the live suite inserts them).
 */
import { convertValue, stagingTypeOf, type StagingType } from "../../../services/upstreamImport/stagingValues";
import { decideTable, STAGED_TABLES, stagingTableOf } from "../../../services/upstreamImport/tablePolicy";
import type { ColumnDef, RawValue } from "../../../services/upstreamImport/dumpParser";
import { UPSTREAM_SQL_IMPORT_ROW_REJECTIONS, UPSTREAM_SQL_IMPORT_TABLE_REASONS } from "@callibrator/contracts/upstreamSqlImport";

const col = (type: string, unsigned = false): ColumnDef => ({ name: "c", type, args: [], unsigned });
const num = (text: string): RawValue => ({ kind: "number", text });
const str = (s: string, charset: "default" | "binary" | "latin1" = "default"): RawValue => ({ kind: "string", bytes: Buffer.from(s, "utf8"), charset });

describe("P24-06 stagingTypeOf — MariaDB column type → staging type", () => {
  it.each([
    ["tinyint", false, "smallint"],
    ["tinyint", true, "smallint"],
    ["smallint", false, "smallint"],
    ["smallint", true, "integer"],
    ["mediumint", true, "integer"],
    ["int", false, "integer"],
    ["int", true, "bigint"],
    ["integer", false, "integer"],
    ["bigint", false, "bigint"],
    ["bigint", true, "numeric"],
    ["year", false, "smallint"],
    ["decimal", false, "numeric"],
    ["dec", false, "numeric"],
    ["fixed", false, "numeric"],
    ["numeric", false, "numeric"],
    ["float", false, "double precision"],
    ["double", false, "double precision"],
    ["real", false, "double precision"],
    ["date", false, "date"],
    ["datetime", false, "timestamp"],
    ["timestamp", false, "timestamp"],
    ["blob", false, "bytea"],
    ["varbinary", false, "bytea"],
    ["varchar", false, "text"],
    ["enum", false, "text"],
    ["time", false, "text"],
    ["json", false, "text"],
    ["bit", false, "text"],
    ["something_new", false, "text"],
  ])("%s (unsigned %s) → %s", (type, unsigned, expected) => {
    expect(stagingTypeOf(col(type, unsigned))).toBe(expected);
  });
});

describe("P24-06 convertValue — every value checked before it is bound", () => {
  const ok = (raw: RawValue, type: StagingType): unknown => {
    const r = convertValue(raw, type);
    if (!r.ok) {
      throw new Error(`refused: ${r.reason}`);
    }
    return r.value;
  };
  const reason = (raw: RawValue, type: StagingType): string | null => {
    const r = convertValue(raw, type);
    return r.ok ? null : r.reason;
  };

  it("NULL is NULL whatever the column", () => {
    expect(ok({ kind: "null" }, "integer")).toBeNull();
  });

  it("integers within their type's range; outside it, or not an integer, refused", () => {
    expect(ok(num("-32768"), "smallint")).toBe("-32768");
    expect(reason(num("32768"), "smallint")).toBe("value_out_of_range");
    expect(ok(num("2147483647"), "integer")).toBe("2147483647");
    expect(reason(num("-2147483649"), "integer")).toBe("value_out_of_range");
    expect(ok(num("9223372036854775807"), "bigint")).toBe("9223372036854775807");
    expect(reason(num("1.5"), "integer")).toBe("value_type_mismatch");
    expect(ok(str("42"), "integer")).toBe("42");
    expect(reason(str("forty-two"), "integer")).toBe("value_type_mismatch");
  });

  it("decimals and doubles; a double past the finite range refused", () => {
    expect(ok(num("1.25e3"), "numeric")).toBe("1.25e3");
    expect(ok(num("-0.5"), "double precision")).toBe("-0.5");
    expect(reason(num("1e400"), "double precision")).toBe("value_out_of_range");
    expect(ok(num("1e400"), "numeric")).toBe("1e400");
    expect(reason(str("1,5"), "numeric")).toBe("value_type_mismatch");
  });

  it("dates and datetimes: real calendar values; MariaDB's zero dates are NULL and noted; nonsense refused", () => {
    expect(ok(str("2024-02-29"), "date")).toBe("2024-02-29");
    expect(convertValue(str("0000-00-00"), "date")).toEqual({ ok: true, value: null, note: "zero_date" });
    expect(convertValue(str("2024-00-10 10:00:00"), "timestamp")).toEqual({ ok: true, value: null, note: "zero_date" });
    expect(convertValue(str("2024-01-00"), "date")).toEqual({ ok: true, value: null, note: "zero_date" });
    expect(reason(str("2023-02-29"), "date")).toBe("invalid_date");
    expect(reason(str("2024-13-01"), "date")).toBe("invalid_date");
    expect(ok(str("2024-01-23 09:15:00.123456"), "timestamp")).toBe("2024-01-23 09:15:00.123456");
    expect(ok(str("2024-01-23T09:15:00"), "timestamp")).toBe("2024-01-23T09:15:00");
    expect(reason(str("2024-01-23 24:00:00"), "timestamp")).toBe("invalid_date");
    expect(reason(str("2024-01-23 23:60:00"), "timestamp")).toBe("invalid_date");
    expect(reason(str("2024-01-23 23:59:60"), "timestamp")).toBe("invalid_date");
    expect(reason(str("yesterday"), "date")).toBe("invalid_date");
    expect(reason(num("20240101"), "date")).toBe("invalid_date");
  });

  it("text: strict UTF-8 (an invalid sequence refused, never replaced), latin1 when introduced so, never a NUL", () => {
    expect(ok(str("Ünïcødé 日本"), "text")).toBe("Ünïcødé 日本");
    expect(reason({ kind: "string", bytes: Buffer.from([0x61, 0xff, 0x62]), charset: "default" }, "text")).toBe("invalid_utf8");
    expect(ok({ kind: "string", bytes: Buffer.from([0xe9]), charset: "latin1" }, "text")).toBe("é");
    expect(reason({ kind: "string", bytes: Buffer.from([0x61, 0x00]), charset: "default" }, "text")).toBe("nul_in_text");
    expect(ok({ kind: "hex", bytes: Buffer.from("hi") }, "text")).toBe("hi");
    expect(ok(num("12.5"), "text")).toBe("12.5");
    expect(ok({ kind: "bit", text: "0101" }, "text")).toBe("0101");
  });

  it("bit literals are numbers to a numeric column", () => {
    expect(ok({ kind: "bit", text: "101" }, "integer")).toBe("5");
    expect(ok({ kind: "bit", text: "" }, "smallint")).toBe("0");
  });

  it("bytea takes the bytes as written — strings, hex, and the spelling of anything else", () => {
    expect(ok({ kind: "string", bytes: Buffer.from([0, 1, 255]), charset: "binary" }, "bytea")).toEqual(Buffer.from([0, 1, 255]));
    expect(ok({ kind: "hex", bytes: Buffer.from([7]) }, "bytea")).toEqual(Buffer.from([7]));
    expect(ok(num("12"), "bytea")).toEqual(Buffer.from("12"));
    expect(ok({ kind: "bit", text: "1" }, "bytea")).toEqual(Buffer.from("1"));
  });

  it("every value reason is in the contract's row-rejection vocabulary", () => {
    for (const r of ["value_type_mismatch", "value_out_of_range", "invalid_date", "invalid_utf8", "nul_in_text"]) {
      expect(UPSTREAM_SQL_IMPORT_ROW_REJECTIONS).toContain(r);
    }
  });
});

describe("P24-06 tablePolicy — 07-DATA-MINIMISATION as code, deny by default", () => {
  it("stages the business tables; `users` without any credential or myth/auth internal column", () => {
    const users = decideTable("users");
    expect(users.stage).toBe(true);
    if (users.stage) {
      expect([...users.excluded].sort()).toEqual(
        ["activate_hash", "deleted_at", "force_pass_reset", "password_hash", "reset_at", "reset_expires", "reset_hash", "status", "status_message", "user_image"].sort(),
      );
    }
    const inventory = decideTable("trx_inventory");
    expect(inventory.stage && inventory.excluded.size).toBe(0);
  });

  it.each([
    ["auth_logins", "not_migrated"],
    ["auth_tokens", "never_copied"],
    ["auth_reset_attempts", "never_copied"],
    ["mst_fotodepan_inventory", "not_migrated"],
    ["migrations", "not_migrated"],
    ["a_table_nobody_listed", "not_in_policy"],
    ["toString", "not_in_policy"],
    ["__proto__", "not_in_policy"],
  ])("never stages %s (%s)", (table, reason) => {
    expect(decideTable(table)).toEqual({ stage: false, reason });
  });

  it("every reason is in the contract's table-reason vocabulary; every staging name fits PostgreSQL's 63 bytes", () => {
    for (const reason of ["not_migrated", "never_copied", "not_in_policy"]) {
      expect(UPSTREAM_SQL_IMPORT_TABLE_REASONS).toContain(reason);
    }
    expect(STAGED_TABLES.length).toBeGreaterThan(40);
    for (const table of STAGED_TABLES) {
      expect(stagingTableOf(table)).toMatch(/^stg_[a-z_]{1,59}$/);
    }
  });
});
