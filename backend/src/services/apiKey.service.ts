// src/services/apiKey.service.ts
//
// Tenant-scoped API keys / service accounts. The full key is returned once at
// creation; only a SHA-256 hash + a display prefix are stored. Scopes are
// "<resource>:<read|write|*>" (or "*") and are enforced by dynamicAccess.
//
// P9-12 (ADR-087 Amendment 14): converted from apiKey.service.js with no
// behaviour change. `export =` keeps the exact object `require()` returned.

import { createHash, randomBytes } from "crypto";
import type { Transaction } from "sequelize";
import models from "../models";
import { API_KEY_SCOPE_RESOURCES } from "@callibrator/contracts/apiKeyScopes";
import { AppError } from "../utils/appError.util";
import { db } from "../config";
import auditService from "./audit.service";
import { DEFAULT_LIMIT, MAX_LIMIT } from "../constants";
import { IMPORT_KEY_NAME, isReservedImportKeyName } from "../constants/upstreamImportKey";
import type { TenantId, UserId } from "../types/ids";
import type { ModelInstance } from "../types/models";

const { ApiKey, Tenant } = models;

type ApiKeyRow = ModelInstance<"ApiKey">;

const KEY_PREFIX = "cbk_";
const LAST_USED_THROTTLE_MS = 60 * 1000;

const hashKey = (raw: string): string => createHash("sha256").update(raw).digest("hex");
const generateRawKey = (): string => KEY_PREFIX + randomBytes(28).toString("hex");

/** A key as the API shows it: never the key or its hash. */
interface PublicApiKey {
  id: string;
  tenantId: TenantId;
  name: string;
  keyPrefix: string;
  scopes: ApiKeyRow["scopes"];
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  isActive: boolean;
  createdBy: UserId | null;
  createdAt: Date;
}

const publicKey = (k: ApiKeyRow): PublicApiKey => ({
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
// Scopes are "<menu slug>:<read|write>". A wildcard resource ("*") is refused:
// a key that matches every resource is indistinguishable from an administrator,
// and SCIM treats any API key as a service account (A-27).
const VALID_ACTIONS = new Set(["read", "write"]);
// A-311: the scope resources are the shared contract, the list the create dialog
// offers; tests/guards/apiKeyScopeCoverage.a311 holds it to every dynamicAccess gate.
const ALLOWED_RESOURCES = new Set<string>(API_KEY_SCOPE_RESOURCES);

const assertScopes = (scopes: unknown): void => {
  if (!Array.isArray(scopes) || scopes.length === 0) {
    throw new AppError(400, "scopes must be a non-empty array of \"<resource>:<read|write>\"");
  }
  for (const raw of scopes as unknown[]) {
    const [resource, action = "write"] = String(raw).toLowerCase().split(":");
    if (resource === "*" || action === "*") {
      throw new AppError(400, "Wildcard scopes are not allowed; name each resource explicitly");
    }
    // `split` always yields a first element.
    if (!ALLOWED_RESOURCES.has(resource as string)) {
      throw new AppError(400, `Unknown scope resource: "${resource as string}"`);
    }
    if (!VALID_ACTIONS.has(action)) {
      throw new AppError(400, `Unknown scope action: "${action}" (use read or write)`);
    }
  }
};

/** Who is acting (the controller's auditActor). */
interface KeyActor {
  userId?: string | null | undefined;
  ipAddress?: string | null;
  /** P9-20: widened to what auditActor(req) returns (type-only; the value is only ever written to the audit row). */
  userAgent?: string | readonly string[] | null;
}

/**
 * A-278 (ADR-094) — minting and revoking a key are audited in the key's
 * tenant, inside the write's transaction. A key is a credential: who created
 * it, with which scopes, and who ended it must be on record. The row names
 * the key by id and display prefix, never the key or its hash.
 *
 * @param transaction - the write's transaction
 * @param actor - who, from where
 * @param tenantId - the key's tenant
 * @param action - "CREATE" or "DELETE"
 * @param key - the ApiKey row
 * @param changes - more non-secret fields
 * @returns logAction's result
 */
const auditKey = (
  transaction: Transaction,
  actor: KeyActor,
  tenantId: string,
  action: "CREATE" | "DELETE",
  key: ApiKeyRow,
  changes: Record<string, unknown>,
): Promise<unknown> =>
  auditService.logAction(
    {
      tenantId,
      /* eslint-disable @typescript-eslint/prefer-nullish-coalescing -- as built: "" means absent */
      userId: actor.userId || null,
      action,
      resourceType: "ApiKey",
      resourceId: key.id,
      changes: { name: key.name, keyPrefix: key.keyPrefix, ...changes },
      ipAddress: actor.ipAddress || null,
      userAgent: actor.userAgent || null,
      /* eslint-enable @typescript-eslint/prefer-nullish-coalescing */
    },
    { transaction },
  );

/** createApiKey's fields. */
interface CreateKeyInput {
  /** P9-20: optional in the type as in fact (an unvalidated body); a missing name is the 400 below. */
  name?: string | undefined;
  scopes: unknown;
  expiresAt?: Date | string | null | undefined;
  createdBy?: UserId | null;
}

const createApiKey = async (
  tenantId: TenantId,
  { name, scopes, expiresAt, createdBy }: CreateKeyInput,
  actor: KeyActor = { userId: createdBy },
): Promise<PublicApiKey & { key: string }> => {
  if (!name) {
    throw new AppError(400, "name is required");
  }
  // P24-04 (ADR-133 Am. 4): the import key is provisioned by the import alone, its key never shown.
  if (isReservedImportKeyName(name)) {
    throw new AppError(400, `"${IMPORT_KEY_NAME}" is reserved for the upstream import's own key; choose another name`);
  }
  assertScopes(scopes);
  // assertScopes refused anything but a non-empty array.
  const scopeArr = (scopes as unknown[]).map((s) => String(s).toLowerCase());
  const raw = generateRawKey();
  const key = await db.transaction(async (transaction) => {
    const created = await ApiKey.create(
      {
        tenantId,
        name,
        keyPrefix: raw.slice(0, 12),
        keyHash: hashKey(raw),
        scopes: scopeArr,
        /* eslint-disable @typescript-eslint/prefer-nullish-coalescing -- as built: "" means none */
        // As built: an ISO string is passed through; Sequelize parses it for the DATE column.
        expiresAt: (expiresAt || null) as Date | null,
        createdBy: createdBy || null,
        /* eslint-enable @typescript-eslint/prefer-nullish-coalescing */
      },
      { transaction },
    );
    await auditKey(transaction, actor, tenantId, "CREATE", created, {
      operation: "API_KEY_CREATE",
      scopes: scopeArr,
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built: "" means none
      expiresAt: expiresAt || null,
    });
    return created;
  });
  // The full key is returned exactly once — it is never retrievable again.
  return { ...publicKey(key), key: raw };
};

/** A page of keys, as listApiKeys returns it (the controller shapes the envelope). */
interface KeyPage {
  rows: PublicApiKey[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

const listApiKeys = async (
  tenantId: TenantId,
  { page = 1, limit = DEFAULT_LIMIT }: { page?: number | string | undefined; limit?: number | string | undefined } = {},
): Promise<KeyPage> => {
  const safeLimit = Math.min(Number(limit) || DEFAULT_LIMIT, MAX_LIMIT);
  const { count, rows } = await ApiKey.findAndCountAll({
    where: { tenantId },
    limit: safeLimit,
    offset: (Number(page) - 1) * safeLimit,
    order: [["createdAt", "DESC"], ["id", "DESC"]],
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

const loadOwned = async (tenantId: TenantId, id: string): Promise<ApiKeyRow> => {
  const key = await ApiKey.findOne({ where: { id, tenantId } });
  if (!key) {
    throw new AppError(404, "API key not found");
  }
  return key;
};

const getApiKey = async (tenantId: TenantId, id: string): Promise<PublicApiKey> => publicKey(await loadOwned(tenantId, id));

const revokeApiKey = async (tenantId: TenantId, id: string, actor: KeyActor = {}): Promise<{ id: string }> => {
  const key = await loadOwned(tenantId, id);
  // A-278: the revocation and its audit row commit together. softDelete()
  // saves without options and joins this transaction through CLS
  // (config/index.js), as model instance methods do.
  await db.transaction(async (transaction) => {
    await key.update({ isActive: false }, { transaction });
    await key.softDelete();
    await auditKey(transaction, actor, tenantId, "DELETE", key, { operation: "API_KEY_REVOKE" });
  });
  return { id };
};

// ------------------------------------------------------------------
// VERIFY (used by the auth middleware)
// ------------------------------------------------------------------
const verifyApiKey = async (raw: string | null | undefined): Promise<ApiKeyRow | null> => {
  // eslint-disable-next-line @typescript-eslint/prefer-optional-chain -- as built
  if (!raw || !raw.startsWith(KEY_PREFIX)) {
    return null;
  }
  const key = await ApiKey.findOne({
    where: { keyHash: hashKey(raw) },
    // INNER JOIN on purpose (A-90): Tenant's defaultScope makes this include
    // required, so a key whose tenant is soft-deleted is not found and does
    // not authenticate. Do not add `required: false` — the tenant would read
    // as null and auth.middleware's suspended/deleted check would pass it.
    include: [{ model: Tenant, as: "tenant", attributes: ["id", "status", "plan"], required: true }],
  });
  // eslint-disable-next-line @typescript-eslint/prefer-optional-chain -- as built
  if (!key || !key.isActive) {
    return null;
  }
  if (key.expiresAt && new Date(key.expiresAt) < new Date()) {
    return null;
  }
  // Update lastUsedAt (throttled, best-effort — never block auth on it).
  const last = key.lastUsedAt ? new Date(key.lastUsedAt).getTime() : 0;
  if (Date.now() - last > LAST_USED_THROTTLE_MS) {
    // eslint-disable-next-line @typescript-eslint/no-empty-function -- as built: best-effort, never blocks auth
    key.update({ lastUsedAt: new Date() }).catch(() => {});
  }
  return key;
};

// ------------------------------------------------------------------
// SCOPE MATCHING (shared with dynamicAccess)
// ------------------------------------------------------------------
// scopes: "<resource>:<read|write|*>" or "<resource>" (implies write) or "*".
// write implies read; "*" resource or action is a wildcard.
const scopeAllows = (scopes: unknown, resource: unknown, action: unknown): boolean => {
  if (!Array.isArray(scopes)) {
    return false;
  }
  const res = String(resource).toLowerCase();
  const act = String(action).toLowerCase() === "read" ? "read" : "write";
  for (const raw of scopes as unknown[]) {
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

export = {
  createApiKey,
  listApiKeys,
  getApiKey,
  revokeApiKey,
  verifyApiKey,
  scopeAllows,
};
