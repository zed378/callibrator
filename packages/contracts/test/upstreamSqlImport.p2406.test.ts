/**
 * P24-06 — the SQL-dump import's request shapes and vocabularies
 * (@callibrator/contracts/upstreamSqlImport), written from the module's rules:
 * the uploader DECLARES the file synthetic or real (nothing else), the list is
 * filtered by a known status and paged within bounds, a run is named by a UUID,
 * and every reason the server reports is a lower-case code.
 */
import {
  UPSTREAM_SQL_IMPORT_COMPRESSIONS,
  UPSTREAM_SQL_IMPORT_DATA_CLASSES,
  UPSTREAM_SQL_IMPORT_ERROR_CODES,
  UPSTREAM_SQL_IMPORT_ROW_REJECTIONS,
  UPSTREAM_SQL_IMPORT_TABLE_REASONS,
  UPSTREAM_SQL_IMPORT_TRANSFORM_STATUSES,
  listUpstreamSqlImportsSchema,
  uploadUpstreamSqlImportSchema,
  upstreamSqlImportIdSchema,
} from "@callibrator/contracts/upstreamSqlImport";
import { UPSTREAM_SQL_IMPORT_STATUSES } from "@callibrator/contracts/states";

describe("P24-06 @callibrator/contracts/upstreamSqlImport", () => {
  it("the upload declares the file synthetic or real — nothing else, and never absent", () => {
    expect(uploadUpstreamSqlImportSchema.parse({ dataClass: "synthetic", extra: "x" })).toEqual({ dataClass: "synthetic" });
    expect(uploadUpstreamSqlImportSchema.parse({ dataClass: "real" })).toEqual({ dataClass: "real" });
    expect(uploadUpstreamSqlImportSchema.safeParse({}).success).toBe(false);
    expect(uploadUpstreamSqlImportSchema.safeParse({ dataClass: "probably-synthetic" }).success).toBe(false);
  });

  it("the list: a known status, page ≥ 1, limit 1 … 100 (query strings converted), defaults 1 / 20", () => {
    expect(listUpstreamSqlImportsSchema.parse({})).toEqual({ page: 1, limit: 20 });
    expect(listUpstreamSqlImportsSchema.parse({ status: "failed", page: "2", limit: "100" })).toEqual({ status: "failed", page: 2, limit: 100 });
    for (const bad of [{ status: "done" }, { page: "0" }, { limit: "101" }, { limit: "1.5" }]) {
      expect(listUpstreamSqlImportsSchema.safeParse(bad).success).toBe(false);
    }
  });

  it("a run is named by a UUID", () => {
    expect(upstreamSqlImportIdSchema.safeParse({ id: "6f1e2d3c-4b5a-4987-8a6b-5c4d3e2f1a0b" }).success).toBe(true);
    expect(upstreamSqlImportIdSchema.safeParse({ id: "1; DROP TABLE x" }).success).toBe(false);
  });

  it("the lifecycle and every vocabulary are fixed, lower-case codes (error codes upper-case), without duplicates", () => {
    expect([...UPSTREAM_SQL_IMPORT_STATUSES]).toEqual(["uploaded", "scanning", "parsing", "loaded", "failed", "cancelled"]);
    expect([...UPSTREAM_SQL_IMPORT_DATA_CLASSES]).toEqual(["synthetic", "real"]);
    expect([...UPSTREAM_SQL_IMPORT_COMPRESSIONS]).toEqual(["none", "gzip"]);
    expect([...UPSTREAM_SQL_IMPORT_TRANSFORM_STATUSES]).toEqual(["not_available"]);
    for (const list of [UPSTREAM_SQL_IMPORT_ROW_REJECTIONS, UPSTREAM_SQL_IMPORT_TABLE_REASONS]) {
      expect(new Set(list).size).toBe(list.length);
      expect(list.every((code) => /^[a-z][a-z0-9_]{0,39}$/.test(code))).toBe(true);
    }
    expect(UPSTREAM_SQL_IMPORT_ERROR_CODES.every((code) => /^[A-Z_]+$/.test(code))).toBe(true);
    expect(Object.isFrozen(UPSTREAM_SQL_IMPORT_ROW_REJECTIONS)).toBe(true);
  });
});
