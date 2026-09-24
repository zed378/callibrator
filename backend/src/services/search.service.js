// src/services/search.service.js
//
// Unified tenant-scoped search across devices, stock, and certificates using
// Postgres full-text search (search_vector + GIN, added by migration 0003),
// ranked by ts_rank. Falls back to ILIKE when the FTS column isn't present
// (e.g. a DB without the migration, or the test DB built from db.sync()).

const { db } = require("../config");
const { QueryTypes } = require("sequelize");
const { logger } = require("../middlewares/activityLog.middleware");
const { AppError } = require("../utils/appError.util");

// Per-type config: table, searchable columns, selected fields, soft-delete cond,
// and the menu slug whose `read` permission a caller needs to see the type.
//
// A-04: `menu` is the SAME slug the type's own list route gates on
// (calibrationDevices.route.js -> "calibration", stock.route.js -> "warehouse",
// certificates.route.js -> "certificate"), so search can never surface a row a
// caller's list endpoint would refuse.
const TYPES = {
  device: {
    menu: "calibration",
    table: "calibration_devices",
    cols: ["name", "serial_number", "manufacturer", "model", "category"],
    select: "id, name, serial_number AS \"serialNumber\", manufacturer, model, category",
    softDelete: "is_deleted = false",
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

const ftsSearch = async (cfg, tenantId, q, limit) => {
  const sql =
    `SELECT ${cfg.select}, ts_rank("search_vector", plainto_tsquery('english', :q)) AS rank ` +
    `FROM "${cfg.table}" ` +
    `WHERE tenant_id = :tenantId AND ${cfg.softDelete} ` +
    "AND \"search_vector\" @@ plainto_tsquery('english', :q) " +
    "ORDER BY rank DESC LIMIT :limit";
  return db.query(sql, {
    replacements: { q, tenantId, limit },
    type: QueryTypes.SELECT,
  });
};

const ilikeSearch = async (cfg, tenantId, q, limit) => {
  const conds = cfg.cols.map((c) => `"${c}" ILIKE :like`).join(" OR ");
  const sql =
    `SELECT ${cfg.select}, 0 AS rank ` +
    `FROM "${cfg.table}" ` +
    `WHERE tenant_id = :tenantId AND ${cfg.softDelete} AND (${conds}) ` +
    "LIMIT :limit";
  return db.query(sql, {
    replacements: { tenantId, like: `%${q}%`, limit },
    type: QueryTypes.SELECT,
  });
};

// A-23. The FTS -> ILIKE fallback used to warn on EVERY search call, which on a
// database without the search_vector column (the unit-test database always)
// is every request. It now warns once per table per process; later fallbacks
// for the same table log at debug.
const ftsFallbackWarned = new Set();

const searchType = async (type, tenantId, q, limit) => {
  const cfg = TYPES[type];
  try {
    return await ftsSearch(cfg, tenantId, q, limit);
  } catch (ftsErr) {
    // Most likely the FTS column isn't present — fall back to ILIKE.
    const note = `FTS unavailable for ${cfg.table} (${ftsErr.message}); using ILIKE`;
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
        ftsError: ftsErr.message,
        ilikeError: ilikeErr.message,
      });
      throw new AppError(
        500,
        `Search failed for ${type}`,
        false,
        { ftsError: ftsErr.message, ilikeError: ilikeErr.message },
      );
    }
  }
};

exports.search = async (tenantId, { q, types, limit = 10 } = {}) => {
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
  const requested = Array.isArray(types)
    ? [...new Set(types)].filter((t) => TYPES[t])
    : Object.keys(TYPES);

  // A-23. The per-type queries run concurrently. The fan-out is bounded by
  // construction: `requested` is a de-duplicated subset of TYPES, so at most
  // Object.keys(TYPES).length (3) statements are in flight per request —
  // well inside the connection pool. A failing type rejects the whole search
  // (A-56) rather than being dropped.
  const rowsPerType = await Promise.all(
    requested.map((type) => searchType(type, tenantId, term, safeLimit)),
  );

  const byType = {};
  const results = [];
  requested.forEach((type, i) => {
    byType[type] = rowsPerType[i].map((r) => ({ type, ...r }));
    results.push(...byType[type]);
  });

  // Merge + rank across types (ILIKE fallback rows have rank 0 → stable order).
  results.sort((a, b) => (Number(b.rank) || 0) - (Number(a.rank) || 0));

  return { query: term, total: results.length, results, byType };
};

exports.SEARCH_TYPES = Object.keys(TYPES);

// type -> menu slug requiring `read`. Consumed by the controller's per-type
// permission filter and by the route gate.
exports.TYPE_MENUS = Object.fromEntries(
  Object.entries(TYPES).map(([type, cfg]) => [type, cfg.menu]),
);

// Every menu that can yield a search result. A principal holding `read` on
// none of them has nothing to search.
exports.SEARCH_MENUS = Object.values(TYPES).map((cfg) => cfg.menu);
