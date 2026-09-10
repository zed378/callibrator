// src/services/apiKey.service.js
//
// Tenant-scoped API keys / service accounts. The full key is returned once at
// creation; only a SHA-256 hash + a display prefix are stored. Scopes are
// "<resource>:<read|write|*>" (or "*") and are enforced by dynamicAccess.

const crypto = require("crypto");
const { ApiKey, Tenant } = require("../models");
const { AppError } = require("../utils/appError.util");
const { DEFAULT_LIMIT, MAX_LIMIT } = require("../constants");

const KEY_PREFIX = "cbk_";
const LAST_USED_THROTTLE_MS = 60 * 1000;

const hashKey = (raw) => crypto.createHash("sha256").update(raw).digest("hex");
const generateRawKey = () => KEY_PREFIX + crypto.randomBytes(28).toString("hex");

const publicKey = (k) => ({
  id: k.id,
  tenantId: k.tenantId,
  name: k.name,
  keyPrefix: k.keyPrefix,
  scopes: k.scopes,
  lastUsedAt: k.lastUsedAt,
  expiresAt: k.expiresAt,
  isActive: k.isActive,
  createdBy: k.createdBy,
  createdAt: k.createdAt,
});

// ------------------------------------------------------------------
// CRUD
// ------------------------------------------------------------------
exports.createApiKey = async (tenantId, { name, scopes, expiresAt, createdBy }) => {
  if (!name) {
    throw new AppError(400, "name is required");
  }
  const scopeArr = Array.isArray(scopes) ? scopes : [];
  const raw = generateRawKey();
  const key = await ApiKey.create({
    tenantId,
    name,
    keyPrefix: raw.slice(0, 12),
    keyHash: hashKey(raw),
    scopes: scopeArr,
    expiresAt: expiresAt || null,
    createdBy: createdBy || null,
  });
  // The full key is returned exactly once — it is never retrievable again.
  return { ...publicKey(key), key: raw };
};

exports.listApiKeys = async (tenantId, { page = 1, limit = DEFAULT_LIMIT } = {}) => {
  const safeLimit = Math.min(Number(limit) || DEFAULT_LIMIT, MAX_LIMIT);
  const { count, rows } = await ApiKey.findAndCountAll({
    where: { tenantId },
    limit: safeLimit,
    offset: (Number(page) - 1) * safeLimit,
    order: [["createdAt", "DESC"]],
  });
  return {
    rows: rows.map(publicKey),
    meta: {
      total: count,
      page: Number(page),
      limit: safeLimit,
      totalPages: Math.ceil(count / safeLimit),
    },
  };
};

const loadOwned = async (tenantId, id) => {
  const key = await ApiKey.findOne({ where: { id, tenantId } });
  if (!key) {
    throw new AppError(404, "API key not found");
  }
  return key;
};

exports.getApiKey = async (tenantId, id) => publicKey(await loadOwned(tenantId, id));

exports.revokeApiKey = async (tenantId, id) => {
  const key = await loadOwned(tenantId, id);
  await key.update({ isActive: false });
  await key.softDelete();
  return { id };
};

// ------------------------------------------------------------------
// VERIFY (used by the auth middleware)
// ------------------------------------------------------------------
exports.verifyApiKey = async (raw) => {
  if (!raw || !raw.startsWith(KEY_PREFIX)) {
    return null;
  }
  const key = await ApiKey.findOne({
    where: { keyHash: hashKey(raw) },
    include: [{ model: Tenant, as: "tenant", attributes: ["id", "status", "plan"] }],
  });
  if (!key || !key.isActive) {
    return null;
  }
  if (key.expiresAt && new Date(key.expiresAt) < new Date()) {
    return null;
  }
  // Update lastUsedAt (throttled, best-effort — never block auth on it).
  const last = key.lastUsedAt ? new Date(key.lastUsedAt).getTime() : 0;
  if (Date.now() - last > LAST_USED_THROTTLE_MS) {
    key.update({ lastUsedAt: new Date() }).catch(() => {});
  }
  return key;
};

// ------------------------------------------------------------------
// SCOPE MATCHING (shared with dynamicAccess)
// ------------------------------------------------------------------
// scopes: "<resource>:<read|write|*>" or "<resource>" (implies write) or "*".
// write implies read; "*" resource or action is a wildcard.
exports.scopeAllows = (scopes, resource, action) => {
  if (!Array.isArray(scopes)) {
    return false;
  }
  const res = String(resource).toLowerCase();
  const act = String(action).toLowerCase() === "read" ? "read" : "write";
  for (const raw of scopes) {
    const s = String(raw).toLowerCase();
    if (s === "*") {
      return true;
    }
    const [sr, sa = "write"] = s.split(":");
    if (sr !== "*" && sr !== res) {
      continue;
    }
    if (sa === "*" || sa === act) {
      return true;
    }
    if (act === "read" && sa === "write") {
      return true; // write implies read
    }
  }
  return false;
};
