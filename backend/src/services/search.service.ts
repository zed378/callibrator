// src/services/search.service.ts
//
// Unified tenant-scoped search across devices, stock, and certificates using
// Postgres full-text search (search_vector + GIN, added by migration 0003),
// ranked by ts_rank. Falls back to ILIKE when the FTS column isn't present
// (e.g. a DB without the migration, or the test DB built from db.sync()).

// P9-18: the statements go through the bind-only helper `sql()` (utils/sql.util,
// P9-07): `$1…$n` bind values, never `replacements`; the tenant predicate is
// BOUND (`tenant_id = $n`), the D-05 rule for helper statements.
//
// P9-18 (ADR-087, Stage C; converted after the sql() move as its own change):
// from search.service.js with no behaviour change. `export =` keeps the exact
// object `require()` returned (the same keys, in the same order). `db`, `sql`,
// the logger and `AppError` are captured once at load, as the `.js`
// destructured them.
import { db as loadedDb } from "../config";
import { sql as loadedSql } from "../utils/sql.util";
import type { SqlRunner } from "../utils/sql.util";
import { logger as loadedLogger } from "../middlewares/activityLog.middleware";
import { AppError as LoadedAppError } from "../utils/appError.util";
import type { TenantId } from "../types/ids";
import type { SeededMenuSlug } from "../constants/seededMenuSlugs";

const db = loadedDb;
// The Sequelize instance is the runner sql() sends through (as meteredBilling and qms do).
const dbRunner = db as unknown as SqlRunner;
const sql = loadedSql;
const logger = loadedLogger;
const AppError = LoadedAppError;

/** One searchable type. */
interface SearchTypeConfig {
  menu: SeededMenuSlug;
  table: string;
  cols: string[];
  select: string;
  softDelete: string;
  /**
   * P21-07 (F-72): a code column matched EXACTLY (upper-cased) beside the full-text match, ranked
   * first — a QR code is one token the English text search would not match as typed.
   */
  exact?: string;
}

/** A row as a statement returns it (its columns depend on the type). */
type SearchRow = Record<string, unknown> & { rank?: unknown };

/** What `search` answers. */
interface SearchResponse {
  query: string;
  total: number;
  results: SearchRow[];
  byType: Record<string, SearchRow[]>;
}

/** The message of a caught error, read as the `.js` read `err.message`. */
const messageOf = (err: unknown): string => (err as Error).message;

// Per-type config: table, searchable columns, selected fields, soft-delete cond,
// and the menu slug whose `read` permission a caller needs to see the type.
//
// A-04: `menu` is the SAME slug the type's own list route gates on
// (calibrationDevices.route.js -> "calibration", stock.route.js -> "warehouse",
// certificates.route.js -> "certificate"), so search can never surface a row a
// caller's list endpoint would refuse.
const TYPES: Record<string, SearchTypeConfig> = {
  device: {
    menu: "calibration",
    table: "calibration_devices",
    cols: ["name", "serial_number", "manufacturer", "model", "category", "qr_code"],
    select: "id, name, serial_number AS \"serialNumber\", qr_code AS \"qrCode\", manufacturer, model, category",
    softDelete: "is_deleted = false",
    exact: "qr_code",
  },
  stock: {
    menu: "warehouse",
    table: "stocks",
    cols: ["item_name", "sku", "serial_number", "description"],
    select: "id, item_name AS \"itemName\", sku, serial_number AS \"serialNumber\", quantity",
    softDelete: "is_deleted = false",
  },
  certificate: {
    menu: "certificate",
    table: "certificates",
    cols: ["certificate_number", "standard", "summary"],
    select: "id, certificate_number AS \"certificateNumber\", status, standard, device_id AS \"deviceId\"",
    softDelete: "deleted_at IS NULL",
  },
};

const ftsSearch = async (cfg: SearchTypeConfig, tenantId: TenantId, q: string, limit: number): Promise<SearchRow[]> => {
  const textRank = "ts_rank(\"search_vector\", plainto_tsquery('english', $1))";
  const textMatch = "\"search_vector\" @@ plainto_tsquery('english', $1)";
  const rank = cfg.exact ? "CASE WHEN \"" + cfg.exact + "\" = upper($1) THEN 1 ELSE " + textRank + " END" : textRank;
  const match = cfg.exact ? "(" + textMatch + " OR \"" + cfg.exact + "\" = upper($1))" : textMatch;
  const statement =
    `SELECT ${cfg.select}, ${rank} AS rank ` +
    `FROM "${cfg.table}" ` +
    `WHERE tenant_id = $2 AND ${cfg.softDelete} ` +
    `AND ${match} ` +
    "ORDER BY rank DESC LIMIT $3";
  return sql<SearchRow>(dbRunner, statement, [q, tenantId, limit]);
};

const ilikeSearch = async (cfg: SearchTypeConfig, tenantId: TenantId, q: string, limit: number): Promise<SearchRow[]> => {
  const conds = cfg.cols.map((c) => `"${c}" ILIKE $2`).join(" OR ");
  const statement =
    `SELECT ${cfg.select}, 0 AS rank ` +
    `FROM "${cfg.table}" ` +
    `WHERE tenant_id = $1 AND ${cfg.softDelete} AND (${conds}) ` +
    "LIMIT $3";
  return sql<SearchRow>(dbRunner, statement, [tenantId, `%${q}%`, limit]);
};

// A-23. The FTS -> ILIKE fallback used to warn on EVERY search call, which on a
// database without the search_vector column (the unit-test database always)
// is every request. It now warns once per table per process; later fallbacks
// for the same table log at debug.
const ftsFallbackWarned = new Set<string>();

const searchType = async (type: string, tenantId: TenantId, q: string, limit: number): Promise<SearchRow[]> => {
  // `type` is one of TYPES' keys: search() filters the requested list by it.
  const cfg = TYPES[type] as SearchTypeConfig;
  try {
    return await ftsSearch(cfg, tenantId, q, limit);
  } catch (ftsErr) {
    // Most likely the FTS column isn't present — fall back to ILIKE.
    const note = `FTS unavailable for ${cfg.table} (${messageOf(ftsErr)}); using ILIKE`;
    if (ftsFallbackWarned.has(cfg.table)) {
      logger.debug(note);
    } else {
      ftsFallbackWarned.add(cfg.table);
      logger.warn(note);
    }
    try {
      return await ilikeSearch(cfg, tenantId, q, limit);
    } catch (ilikeErr) {
      // A-56. This used to `return []`, so a statement failing for ANY
      // reason — missing column, type error, missing grant — rendered as
      // "no results". A second failure now fails the request: it is a 500
      // the error handler shapes (generic message + request id in
      // production), with both causes logged here. See the A-56 card for the
      // alternatives weighed (partial results with a per-type marker).
      logger.error(`Search failed for ${cfg.table}`, {
        type,
        ftsError: messageOf(ftsErr),
        ilikeError: messageOf(ilikeErr),
      });
      throw new AppError(
        500,
        `Search failed for ${type}`,
        false,
        { ftsError: messageOf(ftsErr), ilikeError: messageOf(ilikeErr) },
      );
    }
  }
};

const search = async (
  tenantId: TenantId,
  { q, types, limit = 10 }: { q?: string | null | undefined; types?: unknown; limit?: unknown } = {},
): Promise<SearchResponse> => {
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: `(q || "")`
  const term = (q || "").trim();
  if (!term) {
    return { query: "", total: 0, results: [], byType: {} };
  }
  const safeLimit = Math.min(Math.max(Number(limit) || 10, 1), 50);
  // An explicit list — including an EMPTY one — is honoured as given. Only an
  // absent list means "every type". The caller of this service filters the
  // list by permission (A-04); if an empty allow-list meant "everything", a
  // principal permitted nothing would be handed the lot.
  // De-duplicated, so `types=device,device` cannot run a type twice.
  const requested: string[] = Array.isArray(types)
    // As built: each requested value is looked up in TYPES as given (a non-string key never matches).
    ? [...new Set(types as string[])].filter((t) => TYPES[t])
    : Object.keys(TYPES);

  // A-23. The per-type queries run concurrently. The fan-out is bounded by
  // construction: `requested` is a de-duplicated subset of TYPES, so at most
  // Object.keys(TYPES).length (3) statements are in flight per request —
  // well inside the connection pool. A failing type rejects the whole search
  // (A-56) rather than being dropped.
  const rowsPerType = await Promise.all(
    requested.map((type) => searchType(type, tenantId, term, safeLimit)),
  );

  const byType: Record<string, SearchRow[]> = {};
  const results: SearchRow[] = [];
  requested.forEach((type, i) => {
    // rowsPerType has one entry per requested type, in order.
    const rows = (rowsPerType[i] as SearchRow[]).map((r) => ({ type, ...r }));
    byType[type] = rows;
    results.push(...rows);
  });

  // Merge + rank across types (ILIKE fallback rows have rank 0 → stable order).
  results.sort((a, b) => (Number(b.rank) || 0) - (Number(a.rank) || 0));

  return { query: term, total: results.length, results, byType };
};

const SEARCH_TYPES = Object.keys(TYPES);

// type -> menu slug requiring `read`. Consumed by the controller's per-type
// permission filter and by the route gate.
const TYPE_MENUS: Record<string, string> = Object.fromEntries(
  Object.entries(TYPES).map(([type, cfg]) => [type, cfg.menu]),
);

// Every menu that can yield a search result. A principal holding `read` on
// none of them has nothing to search.
const SEARCH_MENUS = Object.values(TYPES).map((cfg) => cfg.menu);

export = { search, SEARCH_TYPES, TYPE_MENUS, SEARCH_MENUS };
