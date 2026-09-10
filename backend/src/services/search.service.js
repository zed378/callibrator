// src/services/search.service.js
//
// Unified tenant-scoped search across devices, stock, and certificates using
// Postgres full-text search (search_vector + GIN, added by migration 0003),
// ranked by ts_rank. Falls back to ILIKE when the FTS column isn't present
// (e.g. a DB without the migration, or the test DB built from db.sync()).

const { db } = require("../config");
const { QueryTypes } = require("sequelize");
const { logger } = require("../middlewares/activityLog.middleware");

// Per-type config: table, searchable columns, selected fields, soft-delete cond.
const TYPES = {
  device: {
    table: "calibration_devices",
    cols: ["name", "serial_number", "manufacturer", "model", "category"],
    select: "id, name, serial_number AS \"serialNumber\", manufacturer, model, category",
    softDelete: "is_deleted = false",
  },
  stock: {
    table: "stocks",
    cols: ["item_name", "sku", "serial_number", "description"],
    select: "id, item_name AS \"itemName\", sku, serial_number AS \"serialNumber\", quantity",
    softDelete: "is_deleted = false",
  },
  certificate: {
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

const searchType = async (type, tenantId, q, limit) => {
  const cfg = TYPES[type];
  try {
    return await ftsSearch(cfg, tenantId, q, limit);
  } catch (err) {
    // Most likely the FTS column isn't present — fall back to ILIKE.
    logger.warn(`FTS unavailable for ${cfg.table} (${err.message}); using ILIKE`);
    try {
      return await ilikeSearch(cfg, tenantId, q, limit);
    } catch (err2) {
      logger.error(`Search failed for ${cfg.table}: ${err2.message}`);
      return [];
    }
  }
};

exports.search = async (tenantId, { q, types, limit = 10 } = {}) => {
  const term = (q || "").trim();
  if (!term) {
    return { query: "", total: 0, results: [], byType: {} };
  }
  const safeLimit = Math.min(Math.max(Number(limit) || 10, 1), 50);
  const requested =
    Array.isArray(types) && types.length
      ? types.filter((t) => TYPES[t])
      : Object.keys(TYPES);

  const byType = {};
  const results = [];
  for (const type of requested) {
    const rows = await searchType(type, tenantId, term, safeLimit);
    byType[type] = rows.map((r) => ({ type, ...r }));
    results.push(...byType[type]);
  }

  // Merge + rank across types (ILIKE fallback rows have rank 0 → stable order).
  results.sort((a, b) => (Number(b.rank) || 0) - (Number(a.rank) || 0));

  return { query: term, total: results.length, results, byType };
};

exports.SEARCH_TYPES = Object.keys(TYPES);
