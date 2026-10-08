// src/services/tenant.service.ts
//
// P9-13 (ADR-087, Stage C; converted under the four isolation gates): from
// tenant.service.js with no behaviour change. `export =` keeps the exact
// object `require()` returned (the same keys, in the same order; the formerly
// anonymous `exports.x = async () => …` functions are now named after their
// key, the one accepted surface change). The functions never called each
// other through `exports`, so they still call each other directly. Every
// load-time destructure is kept as a capture at load: `Op`, `db`, the three
// models, `logger`, `AppError`, `assertOutboundUrl`, `DEFAULT_LIMIT`,
// `deleteUpload`, `validateInput`, the two schemas, `STORED_LOGO_NAME`, the
// five Redis helpers, the audit-actor helpers, the platform id, the upload
// placeholder and the secret/admin setting helpers; `auditService` is the
// module object. The `.js` also destructured MAX_LIMIT and never read it;
// the unused name is gone (reading a constant has no effect). HOST_URL is
// still read once, at load. The service still
// throws the plain `{ status, message }` object fetchTenants always threw.
/* eslint-disable @typescript-eslint/prefer-nullish-coalescing -- as built: every `||` in this file treats "" (and 0) as absent, which `??` would not (ADR-087 Amendment 14 §4) */
import { Op as LoadedOp } from "sequelize";
import type { CreationAttributes, Transaction, WhereOptions } from "sequelize";

import { db as loadedDb } from "../config";
import models from "../models";
import { logger as loadedLogger } from "../middlewares/activityLog.middleware";
import { AppError as LoadedAppError } from "../utils/appError.util";
import { assertOutboundUrl as loadedAssertOutboundUrl } from "../utils/ssrf.util";
import { DEFAULT_LIMIT as LOADED_DEFAULT_LIMIT } from "../constants";
import { deleteUpload as loadedDeleteUpload } from "../utils/upload.util";
import { validateInput as loadedValidateInput } from "../validators/input";
import {
  createTenantSchema as loadedCreateTenantSchema,
  updateTenantSchema as loadedUpdateTenantSchema,
} from "../validators/tenant.validator";
import { STORED_LOGO_NAME as LOADED_STORED_LOGO_NAME } from "../constants/tenantLogo";
import redis from "./redis.service";
import auditService from "./audit.service";
import { createSelfFacility } from "./clientFacility.service";
import {
  auditEntryActor as loadedAuditEntryActor,
  actorChanges as loadedActorChanges,
} from "../utils/auditPrincipal.util";
import type { AuditActorInput } from "../utils/auditPrincipal.util";
import { PLATFORM_TENANT_ID as LOADED_PLATFORM_TENANT_ID } from "../constants/platformTenant";
import { DEFAULT_UPLOAD_PLACEHOLDER as LOADED_DEFAULT_UPLOAD_PLACEHOLDER } from "../constants/appConstants";
import {
  isRedactedSettingKey as loadedIsRedactedSettingKey,
  SECRET_SETTING_MASK as LOADED_SECRET_SETTING_MASK,
} from "../constants/tenantSecretSettings";
import { isTenantAdminSettingKey as loadedIsTenantAdminSettingKey } from "../constants/tenantAdminSettings";
import { envOr } from "../config/env";
import type { TenantId, UserId } from "../types/ids";
import type { ModelInstance } from "../types/models";

const Op = LoadedOp;
const db = loadedDb;
const { Tenants, Users } = models;
const logger = loadedLogger;
const AppError = LoadedAppError;
const assertOutboundUrl = loadedAssertOutboundUrl;
const DEFAULT_LIMIT = LOADED_DEFAULT_LIMIT;
const deleteUpload = loadedDeleteUpload;
const validateInput = loadedValidateInput;
const createTenantSchema = loadedCreateTenantSchema;
const updateTenantSchema = loadedUpdateTenantSchema;
const STORED_LOGO_NAME = LOADED_STORED_LOGO_NAME;
const { get, set, del, delPattern, cacheKeys } = redis;
const auditEntryActor = loadedAuditEntryActor;
const actorChanges = loadedActorChanges;
const PLATFORM_TENANT_ID = LOADED_PLATFORM_TENANT_ID;

type TenantRow = ModelInstance<"Tenant">;

/** A thrown value, read the way the `.js` read it. */
interface Thrown {
  message?: unknown;
  stack?: unknown;
  status?: unknown;
}

/** A tenant as a response carries it: the plain row, its logo URL, and (in a list) its user count. */
type TenantData = Record<string, unknown> & {
  id?: unknown;
  logo?: unknown;
  settings?: unknown;
  logoBaseUrl?: string | null;
  userCount?: number;
};

/** The service's own response object (the controllers read it). */
interface ServiceResult<T> {
  success: true;
  status: number;
  message: string;
  data: T;
}

/** What fetchTenants caches for the first page. */
interface CachedTenantPage {
  rows: TenantData[];
  meta?: { total?: number; page: number; limit: number; totalPages: number };
}

/** The request's audit actor (auditActor(req) / auditPrincipal(req)), plus updateTenant's flag. */
interface TenantActor extends AuditActorInput {
  actorIsSuperAdmin?: boolean;
  tenantId?: string | null;
}

/**
 * The actor of a create or delete: auditActor(req), typed as it returns it
 * (P9-20, type-only; only ever written to the audit row).
 */
interface RequestActor {
  userId?: string | null;
  tenantId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | readonly string[] | null;
}

// ==========================================
// VALIDATION HELPERS
// ==========================================

/**
 * Validate input data against a schema
 * @param {Object} data - Data to validate
 * @param {import("zod").ZodType} schema - a request schema
 * @returns {Object} - Validated and sanitized data
 */
const validate = <S extends Parameters<typeof validateInput>[1]>(data: unknown, schema: S): ReturnType<typeof validateInput<S>> => {
  return validateInput(data, schema);
};

// ------------------------------------------------------------------
// Constants
// ------------------------------------------------------------------

const safeTenantAttributes = {
  exclude: ["updatedAt", "createdBy"],
};

const { TenantSettings } = models;
const DEFAULT_UPLOAD_PLACEHOLDER = LOADED_DEFAULT_UPLOAD_PLACEHOLDER;
const isRedactedSettingKey = loadedIsRedactedSettingKey;
const SECRET_SETTING_MASK = LOADED_SECRET_SETTING_MASK;
const isTenantAdminSettingKey = loadedIsTenantAdminSettingKey;

const TENANT_LOGO_BASE_URL = `${envOr("HOST_URL", "http://localhost:5000")}/uploads/public/tenant`;

/**
 * Build the public URL for a tenant logo.
 *
 * DEFAULT_UPLOAD_PLACEHOLDER means "no logo uploaded" — the same sentinel the
 * replace paths below already refuse to unlink. Building a URL from it yields
 * /uploads/public/tenant/default.svg, which 404s: nothing ships that file, and
 * /app/uploads is a volume that would shadow it. Null lets the UI fall back.
 *
 * P7-08 / ADR-071 (amendment): only an uploaded file is ever a logo. A row
 * written before that rule may hold something else, and no migration rewrites
 * it:
 *  - a same-origin path (`/uploads/public/tenant/x.png`, an older layout) is
 *    reduced to its file name, as tenantUpload.service already does when it
 *    deletes the file it replaces;
 *  - an absolute URL (`https://…`, `//…`, `data:`) is NOT served: null, so the
 *    UI shows its fallback. Serving it would hotlink a third party (the
 *    viewer's IP and Referer leave the platform), and the page CSP's
 *    `img-src` would block it anyway — a broken image instead of a fallback.
 *
 * @param {string|null|undefined} logo - the stored filename
 * @returns {string|null} the public URL, or null when there is no real logo
 */
const logoUrl = (logo: unknown): string | null => {
  if (!logo || logo === DEFAULT_UPLOAD_PLACEHOLDER) {return null;}
  // eslint-disable-next-line @typescript-eslint/no-base-to-string -- as built: the stored value is coerced as the `.js` coerced it
  const value = String(logo);
  // A scheme (`https:`, `data:`) or a scheme-relative `//host` is off-origin.
  if (value.includes(":") || value.startsWith("//")) {return null;}
  // `split` always yields at least one element, so `pop()` is a string here.
  const name = value.split("/").pop() as string;
  return STORED_LOGO_NAME.test(name) && name !== DEFAULT_UPLOAD_PLACEHOLDER
    ? `${TENANT_LOGO_BASE_URL}/${name}`
    : null;
};

/**
 * Transform tenant instance to plain object with logo baseUrl
 * @param {Object} tenant - Sequelize tenant instance
 * @returns {Object} - Transformed tenant data
 */
const transformTenant = (tenant: TenantRow | null | undefined): TenantData | null => {
  /* istanbul ignore if -- defensive: every caller passes a loaded row (each
     returns 404 or throws first). Its only exercised null path was
     createTenant's after a null insert, which since A-95 throws in the audit
     row, before the commit and before this is reached. */
  if (!tenant) {return null;}
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- as built: a plain object (a cached or test row) without toJSON is copied
  const data = (tenant.toJSON ? tenant.toJSON() : { ...tenant }) as TenantData;
  data.logoBaseUrl = logoUrl(data.logo);
  // A-150: a tenant row never leaves the server carrying a credential, even
  // one written into `tenants.settings` before migration 0035 scrubbed it.
  if (data.settings !== undefined) {
    data.settings = withoutSecretSettings(data.settings);
  }
  return data;
};

/**
 * A-150 — a `tenants.settings` object with every redacted key removed
 * (constants/tenantSecretSettings). A non-object value is returned as is.
 *
 * @param {*} settings - the JSONB column value
 * @returns {*} the same shape, without secret keys
 */
function withoutSecretSettings(settings: unknown): unknown {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    return settings;
  }
  return Object.fromEntries(
    Object.entries(settings).filter(([key]) => !isRedactedSettingKey(key)),
  );
}

/**
 * A-150 — a settings map for a response: every key is listed, so the caller
 * can see a secret is configured, but a secret's value reads SECRET_SETTING_MASK.
 * An empty or null secret stays as it is (nothing is configured).
 *
 * @param {Record<string, *>} settings - key -> decrypted value
 * @returns {Record<string, *>} key -> value or mask
 */
const maskSecretSettings = (settings: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(settings).map(([key, value]) => [
      key,
      isRedactedSettingKey(key) && value !== null && value !== "" ? SECRET_SETTING_MASK : value,
    ]),
  );

/**
 * The settings a `PATCH /tenants/settings` body names. The documented body is
 * `{ tenantId, settings: { key: value } }` (the swagger block on the route,
 * and what the frontend sends); top-level keys are accepted as well, as they
 * always were. Before A-150 the nested object was skipped as an "internal
 * property", so a save from the SSO screen wrote nothing.
 *
 * @param {object} settingsData - the request body
 * @returns {Array<[string, *]>} key/value pairs, `tenantId` excluded
 */
const settingEntries = (settingsData: Record<string, unknown> | null | undefined): [string, unknown][] => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- as built: `tenantId` is destructured only to leave it out of `topLevel`
  const { tenantId: _tenantId, settings: nested, ...topLevel } = settingsData || {};
  const named =
    nested && typeof nested === "object" && !Array.isArray(nested)
      ? { ...topLevel, ...nested }
      : topLevel;
  return Object.entries(named).filter(([key]) => key !== "tenantId" && key !== "settings");
};

/** A-176: tenant settings holding a URL the SERVER calls (not the browser). */
const SERVER_CALLED_URL_SETTINGS: readonly string[] = Object.freeze(["oidc_authority", "ai_base_url"]);

/**
 * A-176 — refuse a `PATCH /tenants/settings` body that names a key outside
 * the tenant-admin allow-list (constants/tenantAdminSettings), or gives a
 * setting a value that is not a scalar. Checked before anything is written:
 * the whole request is refused, not the offending key skipped, so a caller
 * never mistakes a partial save for a complete one.
 *
 * @param {Array<[string, *]>} entries - from settingEntries
 * @throws {AppError} 400 naming the first refused key
 */
const assertTenantAdminSettings = (entries: [string, unknown][]): void => {
  for (const [key, value] of entries) {
    if (!isTenantAdminSettingKey(key)) {
      throw new AppError(400, `Setting "${key}" cannot be changed through tenant settings`);
    }
    if (value !== null && !["string", "number", "boolean"].includes(typeof value)) {
      throw new AppError(400, `Setting "${key}" must be a string, number, boolean or null`);
    }
    // A-176: a URL the server itself will call is checked when it is saved
    // (https in production, no internal/metadata host) — a clear 400 now,
    // not an SSRF later. Empty clears the setting and is allowed. The same
    // guard runs again, with DNS pinned, at every call.
    if (SERVER_CALLED_URL_SETTINGS.includes(key) && typeof value === "string" && value.trim() !== "") {
      assertOutboundUrl(value.trim(), key);
    }
  }
};

// ------------------------------------------------------------------
// GET ALL TENANTS
// ------------------------------------------------------------------
const fetchTenants = async ({
  find,
  page = 1,
  limit = DEFAULT_LIMIT,
}: {
  // P9-20: `undefined` admitted, as the validated query gives it (type-only).
  find?: string | null | undefined;
  page?: number | string | undefined;
  limit?: number | string | undefined;
}): Promise<ServiceResult<{ rows: TenantData[]; count: number; meta: CachedTenantPage["meta"] }>> => {
  try {
    // Only cache simple fetches (no search, paginated)
    const shouldCache = !find && Number(page) === 1;

    if (shouldCache) {
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions -- as built: the limit is interpolated as the caller passed it
      const cacheKey = `tenants:page:1:limit:${limit}`;
      const cached = (await get(cacheKey)) as CachedTenantPage | null;
      if (cached) {
        return {
          success: true,
          status: 200,
          message: "Fetch tenants successful (cached)",
          data: {
            rows: cached.rows,
            count: cached.meta?.total || 0,
            meta: cached.meta,
          },
        };
      }
    }

    const whereClause: WhereOptions = {};

    // Free-text search, case-insensitive. A-320: ILIKE on the term as typed —
    // it was lower-cased under LIKE, which is case-sensitive on PostgreSQL (the
    // "MySQL compatible" comment here predated ADR-039), so "Acme" missed "Acme".
    if (find) {
      const searchTerm = `%${find}%`;
      (whereClause as Record<symbol, unknown>)[Op.or] = [
        { name: { [Op.iLike]: searchTerm } },
        { code: { [Op.iLike]: searchTerm } },
        { description: { [Op.iLike]: searchTerm } },
      ];
    }

    // Query tenants with a separate user-count subquery to avoid N+1
    const tenantRows = await Tenants.findAll({
      where: whereClause,
      attributes: safeTenantAttributes,
      order: [["id", "DESC"]],
      limit: Number(limit),
      offset: (Number(page) - 1) * Number(limit),
    });

    // Count total matching tenants
    const totalCount = await Tenants.count({ where: whereClause });

    // Get user counts per tenant in a single query
    // `tenantId` is the attribute (A-88; there is no `tenant_id` attribute any
    // more): `where` maps it to the column. The selected and grouped
    // expressions are the COLUMN name on purpose — Sequelize maps neither an
    // aliased attribute pair nor `group` to fields, so "tenant_id" is quoted
    // as-is and "tenantId" would name a column that does not exist.
    const userCounts = (await Users.findAll({
      attributes: [
        ["tenant_id", "id"],
        // The models barrel sets `db.sequelize = db` when it loads (models/index.ts).
        [(db as typeof db & { sequelize: typeof db }).sequelize.fn("COUNT", "*"), "count"],
      ],
      where: { tenantId: tenantRows.map((t) => t.id) },
      group: ["tenant_id"],
      raw: true,
    })) as unknown[] as { id: string; count: string }[];

    const countMap = userCounts.reduce<Record<string, number>>((acc, row) => {
      acc[row.id] = parseInt(row.count, 10);
      return acc;
    }, {});

    // Transform tenants to include logoBaseUrl and user count
    // A-150: through transformTenant, like every other tenant response, so a
    // list row is stripped of secret settings too.
    const transformedRows = tenantRows.map((tenant) => {
      const data = transformTenant(tenant) as TenantData;
      data.userCount = countMap[data.id as string] || 0;
      return data;
    });

    const resultData = {
      rows: transformedRows,
      count: totalCount,
      meta: {
        total: totalCount,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(totalCount / Number(limit)),
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-meaningless-void-operator -- as built: `resultData` is computed and never read; kept so the conversion evaluates exactly what the `.js` evaluated
    void resultData;

    // Cache first page only for 5 minutes
    if (shouldCache) {
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions -- as built: the limit is interpolated as the caller passed it
      const cacheKey = `tenants:page:1:limit:${limit}`;
      await set(
        cacheKey,
        {
          rows: transformedRows,
          meta: {
            total: totalCount,
            page: Number(page),
            limit: Number(limit),
            totalPages: Math.ceil(totalCount / Number(limit)),
          },
        },
        300,
      );
    }

    // Return result
    return {
      success: true,
      status: 200,
      message: "Fetch tenants successful",
      data: {
        rows: transformedRows,
        count: totalCount,
        meta: {
          total: totalCount,
          page: Number(page),
          limit: Number(limit),
          totalPages: Math.ceil(totalCount / Number(limit)),
        },
      },
    };
  } catch (error) {
    const failure = error as Thrown;
    logger.error("Error fetching tenants", {
      error: failure.message,
      stack: failure.stack,
    });
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- as built: a plain { status, message } object, which the controller reads
    throw {
      status: failure.status || 500,
      message: failure.message || "Internal server error",
    };
  }
};

// ------------------------------------------------------------------
// GET SPECIFIC TENANT
// ------------------------------------------------------------------
const fetchSpecificTenant = async (tenantId: TenantId): Promise<ServiceResult<unknown>> => {
  try {
    // Try cache first
    const cacheKey = cacheKeys.tenant(tenantId);
    const cached = await get(cacheKey);
    if (cached) {
      return {
        success: true,
        status: 200,
        message: "Fetch tenant successful (cached)",
        data: cached,
      };
    }

    const tenant = await Tenants.findByPk(tenantId, {
      attributes: safeTenantAttributes,
      include: [
        {
          model: Users,
          as: "users",
          attributes: ["id", "username", "email", "status"],
          required: false,
        },
      ],
    });

    if (!tenant) {
      return {
        success: true,
        status: 404,
        message: "Tenant not found",
        data: null,
      };
    }

    // Transform tenant to include logoBaseUrl
    const transformedTenant = transformTenant(tenant);

    // Cache for 10 minutes
    await set(cacheKey, transformedTenant, 600);

    return {
      success: true,
      status: 200,
      message: "Fetch tenant successful",
      data: transformedTenant,
    };
  } catch (error) {
    logger.error("Error fetching specific tenant", { error: (error as Thrown).message });
    throw new AppError(500, "Internal server error");
  }
};

// ------------------------------------------------------------------
// MIDDLEWARE HELPERS (No ORM leak in middlewares)
// ------------------------------------------------------------------
const getTenantByIdForMiddleware = async (tenantId: TenantId): Promise<TenantRow | null> => {
  return await Tenants.findByPk(tenantId, {
    attributes: ["id", "name", "status"],
  });
};

const getTenantByCodeForMiddleware = async (tenantCode: string): Promise<TenantRow | null> => {
  return await Tenants.findOne({
    // Changed to 'code' as querying 'name' with a 'code' header is incorrect
    where: { code: tenantCode, status: "active" },
    attributes: ["id", "name", "status"],
  });
};

// ------------------------------------------------------------------
// PUBLIC BRANDING (unauthenticated) — used by the login/register page
// before sign-in. Returns ONLY non-sensitive branding fields (no users,
// settings, contacts, or plan). Active tenants only.
// ------------------------------------------------------------------
const getPublicBranding = async (tenantId: TenantId): Promise<unknown> => {
  const cacheKey = `tenant:branding:${tenantId}`;
  const cached = await get(cacheKey);
  if (cached) {
    return cached;
  }

  const tenant = await Tenants.findOne({
    where: { id: tenantId, status: "active" },
    attributes: ["id", "name", "code", "primaryColor", "logo"],
  });
  if (!tenant) {
    return null;
  }

  const data = tenant.toJSON();
  const branding = {
    id: data.id,
    name: data.name,
    code: data.code,
    primaryColor: data.primaryColor || null,
    logoBaseUrl: logoUrl(data.logo),
  };

  await set(cacheKey, branding, 300);
  return branding;
};

// ------------------------------------------------------------------
// CREATE TENANT
// ------------------------------------------------------------------
/**
 * Create a tenant (a platform operation — the route is superAdminOnly, A-76).
 *
 * A-95: the create and its audit row share the transaction (A-41). A-125
 * (ADR-051 Q-14, F-7): the row is recorded under the reserved PLATFORM tenant.
 * It used to go under the ACTOR's home tenant (BR-A41-4) — for the seeded
 * super admin, "Default Hospital Tenant", whose admins could then read every
 * other hospital's creation. The new tenant's own history begins with it only
 * in the resourceId. `actor.tenantId` is no longer read here.
 *
 * @param {object} input - fields to validate against createTenantSchema
 * @param {string|null} createdBy - the acting user id (from req.user)
 * @param {{tenantId?: (string|null), ipAddress?: (string|null),
 *   userAgent?: (string|null)}} [actor] - the request's audit actor
 * @param {{transaction?: object}} [options] - P10-05: an OUTER transaction
 *   (an access-request approval creates the tenant, its first administrator
 *   and their audit rows together). When given, the create runs in it and this
 *   function neither commits nor rolls it back, and the cache writes wait for
 *   its commit (`afterCommit`), so a rolled-back approval leaves no cached
 *   tenant. When absent, the behaviour is exactly what it was.
 */
const createTenant = async (
  input: { subdomain?: string | null } & Record<string, unknown>,
  createdBy: UserId | null | undefined,
  actor: RequestActor = {},
  options: { transaction?: Transaction | null } = {},
): Promise<ServiceResult<TenantData | null>> => {
  // Validate input
  const data = validate(input, createTenantSchema);
  const {
    name,
    code,
    description,
    logo,
    primaryColor,
    limitSeats,
    email,
    phone,
    address,
    city,
    state,
    zipCode,
    country,
    website,
  } = data;

  // The model requires a unique lowercase `subdomain` (never collected by the
  // create form/validator) and a non-null `email` (which the form treats as
  // optional). Derive a schema-valid subdomain from the required, unique code,
  // and fall back to a code-based email — otherwise a minimal payload hits a
  // notNull violation and returns 500 instead of creating the tenant.
  const subdomain =
    (input.subdomain || code)
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-conversion -- as built: a JavaScript caller may pass a non-string subdomain or code
      .toString()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/^-+|-+$/g, "")
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-conversion -- as built: a JavaScript caller may pass a non-string code
      .slice(0, 63) || code.toString().toLowerCase();
  const tenantEmail = email || `${subdomain}@example.com`;

  const outer = options.transaction || null;
  const transaction = outer || (await db.transaction());
  // P10-05: only a transaction this function opened is its to finish.
  const rollbackOwn = async (): Promise<void> => {
    if (!outer) {
      await transaction.rollback();
    }
  };

  try {
    // Check if code already exists
    const existingCode = await Tenants.findOne({
      where: { code },
      transaction,
    });

    if (existingCode) {
      await rollbackOwn();
      throw new AppError(409, "Tenant code already exists");
    }

    // Check if name already exists
    const existingName = await Tenants.findOne({
      where: { name },
      transaction,
    });

    if (existingName) {
      await rollbackOwn();
      throw new AppError(409, "Tenant name already exists");
    }

    const tenant = await Tenants.create(
      {
        name,
        code,
        subdomain,
        description: description || null,
        logo: logo || "default.svg",
        primaryColor: primaryColor || null,
        // Seat limit: `limitSeats` only (null = unlimited). Absent, the model
        // default applies. `maxUsers || 10` was written here and dropped.
        ...(limitSeats === undefined ? {} : { limitSeats }),
        email: tenantEmail,
        phone: phone || null,
        address: address || null,
        city: city || null,
        state: state || null,
        zipCode: zipCode || null,
        country: country || null,
        website: website || null,
        // A-328: no `createdBy` — not a Tenant attribute (Sequelize dropped it).
        // The creator is recorded by the CREATE audit row below.
      },
      { transaction },
    );

    // P20-07 (ADR-124 Am. 2 § 4): the tenant's own client facility, in the same
    // transaction, audited in the NEW tenant — every tenant has exactly one.
    const selfFacility = await createSelfFacility(tenant, { userId: createdBy || null }, { transaction });

    // A-95: inside the transaction — a failed insert re-throws and the tenant
    // is not created. A-125: recorded under PLATFORM, never the actor's home
    // tenant (F-7).
    await auditService.logAction(
      {
        tenantId: PLATFORM_TENANT_ID,
        userId: createdBy || null,
        action: "CREATE",
        resourceType: "Tenant",
        resourceId: tenant.id,
        changes: {
          after: {
            name: tenant.name,
            code: tenant.code,
            subdomain: tenant.subdomain,
            limitSeats: tenant.limitSeats,
          },
          selfFacilityId: selfFacility.id,
        },
        ipAddress: actor.ipAddress || null,
        userAgent: actor.userAgent || null,
      },
      { transaction },
    );

    // Transform tenant to include logoBaseUrl
    const transformedTenant = transformTenant(tenant);

    const writeCache = async (): Promise<void> => {
      // Cache new tenant by ID and code
      await set(cacheKeys.tenant(tenant.id), transformedTenant, 600);
      await set(cacheKeys.tenantByCode(code), transformedTenant, 600);

      // Invalidate tenant list cache
      await delPattern("tenants:*");
    };

    if (outer) {
      // P10-05: the tenant exists only if the OUTER transaction commits, so
      // the cache learns of it only then; a failed cache write is logged, as
      // the commit has already happened.
      outer.afterCommit(() =>
        writeCache().catch((cacheError: unknown) => {
          logger.warn("Tenant cache not written after commit", {
            tenantId: tenant.id,
            error: (cacheError as Thrown).message,
          });
        }),
      );
    } else {
      await transaction.commit();
      await writeCache();
    }

    logger.info("Tenant created", {
      tenantId: tenant.id,
      code: tenant.code,
      createdBy,
    });

    return {
      success: true,
      status: 201,
      message: "Tenant created successfully",
      data: transformedTenant,
    };
  } catch (error) {
    // Only rollback if transaction is still active (not finished) — and only
    // one this function opened (P10-05: the caller owns an outer one).
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- as built: `transaction &&` guards a test double that resolves no transaction
    if (!outer && transaction && !(transaction as Transaction & { finished?: unknown }).finished) {
      await transaction.rollback().catch(() => {
        // Ignore rollback errors if transaction is already finished
      });
    }
    logger.error("Error creating tenant", { error: (error as Thrown).message });
    throw error;
  }
};

// ------------------------------------------------------------------
// UPDATE TENANT
// ------------------------------------------------------------------

/**
 * A-63. Fields of a tenant that belong to the PLATFORM, not to the tenant.
 *
 *  - `status` — SUSPENDED/INACTIVE locks every user of the tenant out at
 *    auth.middleware, including whoever set it, and recovery then needs a
 *    super admin. The platform already owns this transition
 *    (PATCH /admin/tenants/:id/status, super-admin only).
 *
 * So only a super admin may CHANGE it. A non-super-admin resubmitting the
 * current value (a form that posts every field) is not a change and passes.
 *
 * A-303: `maxUsers` was listed here too, but it was never a Tenant attribute
 * (the seat limit is the plan's `limitSeats`), so no edit of it was ever
 * stored. It is no longer an edit field: updateTenantSchema strips it.
 */
const PLATFORM_CONTROLLED_FIELDS = Object.freeze(["status"] as const);

/**
 * The platform-controlled fields `data` would actually change on `tenant`.
 *
 * @param {object} tenant - the loaded row
 * @param {{status?: string}} data - validated input
 * @returns {string[]} the names of the fields that would change
 */
const platformFieldChanges = (tenant: TenantRow, { status }: { status?: string | null | undefined }): string[] => {
  const changed: string[] = [];
  // `status || tenant.status` below: an empty or null status is "no change".
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-conversion -- as built: a JavaScript caller may pass a non-string status
  if (status && String(status).toUpperCase() !== String(tenant.status).toUpperCase()) {
    changed.push("status");
  }
  return changed;
};

/** The columns updateTenant can write, for the audit row's before/after. */
const AUDITED_TENANT_FIELDS = Object.freeze([
  "name",
  "code",
  "description",
  "logo",
  "primaryColor",
  ...PLATFORM_CONTROLLED_FIELDS,
  "email",
  "phone",
  "address",
  "city",
  "state",
  "zipCode",
  "country",
  "website",
] as const);

/**
 * Update a tenant.
 *
 * A-63 — `actor` decides which tenant may be changed and which fields:
 *  - a non-super-admin may update ONLY their own tenant. Any other id answers
 *    404 "Tenant not found", byte-identical to an id that does not exist
 *    (CLAUDE.md: cross-tenant is 404, never 403). `tenants` is not itself
 *    tenant-scoped, so `findByPk` alone would load anyone's tenant.
 *  - a non-super-admin may not change PLATFORM_CONTROLLED_FIELDS (403 — the
 *    tenant is their own, so this is a permission failure inside it).
 * The actor defaults to "nobody": a caller that passes none is refused.
 *
 * The change is audited inside the transaction (A-41).
 *
 * @param {string} tenantId
 * @param {object} input - fields to validate against updateTenantSchema
 * @param {string|null} updatedBy - the acting user id
 * @param {{actorIsSuperAdmin?: boolean, tenantId?: (string|null),
 *   userId?: (string|null), ipAddress?: (string|null), userAgent?: (string|null)}} [actor]
 */
const updateTenant = async (
  // P9-20: the validated body's optional tenantId, as the controller passes it (type-only).
  tenantId: string | undefined,
  input: unknown,
  updatedBy: string | null | undefined,
  actor: TenantActor = {},
): Promise<ServiceResult<TenantData | null>> => {
  const actorIsSuperAdmin = actor.actorIsSuperAdmin === true;
  // Validate input
  const data = validate(input, updateTenantSchema);
  const {
    name,
    code,
    description,
    logo,
    primaryColor,
    status,
    email,
    phone,
    address,
    city,
    state,
    zipCode,
    country,
    website,
  } = data;

  const transaction = await db.transaction();

  try {
    const tenant = await Tenants.findByPk(tenantId, { transaction });

    // A-63: another tenant's row answers exactly as a missing one does.
    const foreign =
      Boolean(tenant) &&
      !actorIsSuperAdmin &&
      String((tenant as TenantRow).id) !== String(actor.tenantId);
    if (!tenant || foreign) {
      if (foreign) {
        logger.warn("tenant.service: cross-tenant update refused", {
          reason: "cross-tenant",
          tenantId: String(tenantId),
          actorTenantId: String(actor.tenantId),
          updatedBy,
        });
      }
      throw new AppError(404, "Tenant not found");
    }

    if (!actorIsSuperAdmin) {
      const refused = platformFieldChanges(tenant, data);
      if (refused.length > 0) {
        throw new AppError(
          403,
          `Only a platform administrator can change a tenant's ${refused.join(" or ")}`,
        );
      }
    }

    // A-326 (ADR-112): an edit never changes a tenant's status. The validator
    // upper-cases it and the column is the lower-case ENUM, so writing it was a
    // 500 on every edit that carried one (the edit modal always does). The
    // current status resubmitted, in any case, is no change; a different one is a
    // state transition, and that is the lifecycle's (suspend / resume write the
    // ADR-094 suspension marks). A value the ENUM does not have is a 400.
    if (status) {
      const requested = status.toLowerCase();
      if (requested !== String(tenant.status).toLowerCase()) {
        // `status` is DataTypes.ENUM(...), so its attribute always carries `values`.
        const known = Tenants.getAttributes().status.values as readonly string[];
        if (!known.includes(requested)) {
          throw new AppError(400, `Unknown tenant status "${status}": a tenant is ${known.join(", ")}`);
        }
        throw new AppError(
          409,
          `This tenant is "${String(tenant.status)}". Its status changes through the tenant lifecycle ` +
            `(POST /tenants/${String(tenant.id)}/suspend or /resume), not through an edit`,
        );
      }
    }

    // A-327: tenants.email is NOT NULL and an email. Clearing it is a 400 here,
    // not a model validation error (a 500) at the write.
    if (email === null || email === "") {
      throw new AppError(400, "A tenant's email cannot be cleared; send a new address instead");
    }

    const before: Record<string, unknown> = {};
    for (const field of AUDITED_TENANT_FIELDS) {
      before[field] = tenant[field];
    }

    // Check if code already exists (excluding current tenant)
    if (code) {
      const existingCode = await Tenants.findOne({
        where: { code, id: { [Op.ne]: tenantId } },
        transaction,
      });

      if (existingCode) {
        throw new AppError(409, "Tenant code already exists");
      }
    }

    // Check if name already exists (excluding current tenant)
    if (name) {
      const existingName = await Tenants.findOne({
        where: { name, id: { [Op.ne]: tenantId } },
        transaction,
      });

      if (existingName) {
        throw new AppError(409, "Tenant name already exists");
      }
    }

    // A-79: the file the new logo replaces is only REMEMBERED here. It is
    // deleted after the commit (below): deleted before it, any rollback — a
    // failed audit insert included — left the tenant pointing at a file that
    // no longer exists.
    const newLogo = logo || tenant.logo;
    const replacedLogo =
      logo && logo !== tenant.logo ? (tenant.logo || "").split("/").pop() : null;

    await tenant.update(
      {
        name: name || tenant.name,
        code: code || tenant.code,
        description:
          description !== undefined ? description : tenant.description,
        logo: newLogo,
        primaryColor:
          primaryColor !== undefined ? primaryColor || null : tenant.primaryColor,
        // A-326: no `status` — an edit does not change it (checked above).
        // A-327: a null or empty email was refused above.
        email: email !== undefined ? email : tenant.email,
        phone: phone !== undefined ? phone : tenant.phone,
        address: address !== undefined ? address : tenant.address,
        city: city !== undefined ? city : tenant.city,
        state: state !== undefined ? state : tenant.state,
        zipCode: zipCode !== undefined ? zipCode : tenant.zipCode,
        country: country !== undefined ? country : tenant.country,
        website: website !== undefined ? website : tenant.website,
      },
      { transaction },
    );

    // Every mutation writes its audit row inside the transaction (A-41): a
    // failed insert re-throws and rolls the update back with it.
    const changes: Record<string, unknown> = {};
    for (const field of AUDITED_TENANT_FIELDS) {
      if (tenant[field] !== before[field]) {
        changes[field] = { before: before[field], after: tenant[field] };
      }
    }
    await auditService.logAction(
      {
        tenantId: tenant.id,
        // A-282 (ADR-100): an API key is system:api-key, its id in changes.
        ...auditEntryActor({ ...actor, userId: updatedBy || null }),
        action: "UPDATE",
        resourceType: "Tenant",
        resourceId: tenant.id,
        changes: { ...changes, ...actorChanges(actor) },
      },
      { transaction },
    );

    await transaction.commit();

    if (replacedLogo && replacedLogo !== "default.svg") {
      try {
        await deleteUpload(replacedLogo, "uploads/public/tenant");
      } catch (err) {
        // The update is committed; a leftover file is a storage leak, not a
        // reason to report the update as failed.
        logger.warn(`Failed to delete old logo: ${replacedLogo}`, err);
      }
    }

    // Transform tenant to include logoBaseUrl
    const transformedTenant = transformTenant(tenant);

    // Update cache with new tenant data
    await set(cacheKeys.tenant(tenantId), transformedTenant, 600);

    // Update cache by code if code changed
    if (code && code !== tenant.code) {
      await del(cacheKeys.tenantByCode(tenant.code));
      await set(cacheKeys.tenantByCode(code), transformedTenant, 600);
    }

    // Invalidate tenant list cache
    await delPattern("tenants:*");

    logger.info("Tenant updated", {
      tenantId,
      updatedBy,
    });

    return {
      success: true,
      status: 200,
      message: "Tenant updated successfully",
      data: transformedTenant,
    };
  } catch (error) {
    // Only rollback if transaction is still active (not finished)
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- as built: `transaction &&` guards a test double that resolves no transaction
    if (transaction && !(transaction as Transaction & { finished?: unknown }).finished) {
      await transaction.rollback().catch(() => {
        // Ignore rollback errors if transaction is already finished
      });
    }
    logger.error("Error updating tenant", { error: (error as Thrown).message });
    throw error;
  }
};

// ------------------------------------------------------------------
// DELETE TENANT
// ------------------------------------------------------------------
/**
 * Delete (soft — the model is paranoid) a tenant. A platform operation: the
 * route is superAdminOnly (A-76).
 *
 * A-95: the actor comes from the authenticated request only (it was read from
 * the body or query as `deletedBy`, so the row could name anyone), and the
 * delete and its audit row share the transaction. A-125 (ADR-051 Q-14, F-7):
 * the row is recorded under the reserved PLATFORM tenant — not under the
 * actor's home tenant (a hospital, whose admins could read it) and not under
 * the deleted tenant. The PLATFORM tenant itself cannot be deleted here: the
 * Tenant model hides it, so it answers 404 like an id that does not exist.
 *
 * @param {string} tenantId
 * @param {{userId?: (string|null), tenantId?: (string|null),
 *   ipAddress?: (string|null), userAgent?: (string|null)}} [actor] - auditActor(req)
 */
const deleteTenant = async (tenantId: TenantId, actor: RequestActor = {}): Promise<ServiceResult<null>> => {
  const deletedBy = actor.userId || null;
  const transaction = await db.transaction();

  try {
    const tenant = await Tenants.findByPk(tenantId, { transaction });

    if (!tenant) {
      await transaction.rollback();
      throw new AppError(404, "Tenant not found");
    }

    // Check if tenant has users
    const userCount = await Users.count({
      where: { tenantId },
      transaction,
    });

    if (userCount > 0) {
      await transaction.rollback();
      // AppError is (status, message) — the arguments were swapped here, so
      // this surfaced with .status set to the message string and .message set
      // to 400, producing a garbage HTTP status instead of a 400.
      throw new AppError(
        400,
        `Cannot delete tenant with ${String(userCount)} active user(s). Please remove or reassign users first.`,
      );
    }

    await tenant.destroy({ transaction });

    // A-125: under PLATFORM (F-7). Not under the deleted tenant either: a
    // platform operation belongs to the platform's trail.
    await auditService.logAction(
      {
        tenantId: PLATFORM_TENANT_ID,
        userId: deletedBy,
        action: "DELETE",
        resourceType: "Tenant",
        resourceId: tenant.id,
        changes: {
          before: { name: tenant.name, code: tenant.code, status: tenant.status },
          after: { deleted: true },
        },
        ipAddress: actor.ipAddress || null,
        userAgent: actor.userAgent || null,
      },
      { transaction },
    );

    await transaction.commit();

    // The logo file goes only after the commit (the A-79 shape): deleted
    // before it, a rolled-back delete left a live tenant with no logo file.
    if (tenant.logo) {
      const logoFilename = tenant.logo.split("/").pop();
      if (logoFilename && logoFilename !== "default.svg") {
        try {
          await deleteUpload(logoFilename, "uploads/public/tenant");
        } catch (err) {
          logger.warn(`Failed to delete tenant logo: ${logoFilename}`, err);
        }
      }
    }

    // Invalidate all tenant caches
    await del(cacheKeys.tenant(tenantId));
    await del(cacheKeys.tenantByCode(tenant.code));
    await delPattern("tenants:*");
    await delPattern(`tenant:settings:${tenantId}`);

    logger.info("Tenant deleted", {
      tenantId,
      deletedBy,
    });

    return {
      success: true,
      status: 200,
      message: "Tenant deleted successfully",
      data: null,
    };
  } catch (error) {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- as built: `transaction &&` guards a test double that resolves no transaction
    if (transaction && !(transaction as Transaction & { finished?: unknown }).finished) {
      await transaction.rollback().catch(() => {
        // Ignore rollback errors if transaction is already finished
      });
    }
    logger.error("Error deleting tenant", { error: (error as Thrown).message });
    throw error;
  }
};

// ------------------------------------------------------------------
// GET TENANT SETTINGS
// ------------------------------------------------------------------
/**
 * A tenant's settings: the `tenant_settings` rows, with non-secret keys of the
 * `tenants.settings` JSONB column as a fallback.
 *
 * A-150: secret values are MASKED unless `includeSecrets` is set. This answers
 * `POST /tenants/settings`, which returned every decrypted credential (OIDC
 * client secret, storage keys, the AI vendor key) to any Management reader.
 * Only in-process callers that must USE a secret (the SSO flows) ask for it.
 * The result is no longer cached in Redis: the cached copy held the decrypted
 * secrets in plaintext for 15 minutes. A secret is never taken from the JSONB
 * fallback — it lives only in `tenant_settings`, encrypted.
 *
 * @param {string} tenantId - the tenant
 * @param {{includeSecrets?: boolean}} [options] - includeSecrets: return the
 *   decrypted values; never pass it on a path that responds with the result
 * @returns {Promise<object>} the service envelope; data `{ tenant, settings }`
 */
const getTenantSettings = async (
  tenantId: TenantId,
  { includeSecrets = false }: { includeSecrets?: boolean } = {},
): Promise<ServiceResult<{ tenant: TenantData | null; settings: Record<string, unknown> } | null>> => {
  try {
    const tenant = await Tenants.findByPk(tenantId);

    if (!tenant) {
      return {
        success: true,
        status: 404,
        message: "Tenant not found",
        data: null,
      };
    }

    const settings: Record<string, unknown> = {};

    // 1. Load from TenantSettings key-value table (afterFind decrypts)
    const dbSettings = await TenantSettings.findAll({
      where: { tenantId },
    });
    for (const s of dbSettings) {
      settings[s.key] = s.value;
    }

    // 2. Fallback from the JSONB settings column — never for a secret key
    const rawSettings = tenant.settings;
    if (rawSettings && typeof rawSettings === "object") {
      for (const [key, val] of Object.entries(rawSettings)) {
        if (settings[key] === undefined && !isRedactedSettingKey(key)) {
          settings[key] = val;
        }
      }
    }

    return {
      success: true,
      status: 200,
      message: "Fetch tenant settings successful",
      data: {
        tenant: transformTenant(tenant),
        settings: includeSecrets ? settings : maskSecretSettings(settings),
      },
    };
  } catch (error) {
    logger.error("Error fetching tenant settings", { error: (error as Thrown).message });
    throw new AppError(500, "Internal server error");
  }
};

// ------------------------------------------------------------------
// UPDATE TENANT SETTINGS
// ------------------------------------------------------------------
/**
 * Upsert tenant settings.
 *
 * A-117: audited — one UPDATE row on the tenant, written in the SAME
 * transaction as the settings, so a rolled-back change leaves no row and a
 * committed one always has one. The row names the keys that were created or
 * changed, not their values: settings can carry credentials (SMTP, storage),
 * and audit_logs is permanent.
 *
 * A-150: the settings live in `tenant_settings` ONLY, where the model
 * envelope-encrypts every secret key. This used to re-read every row — which
 * the model DECRYPTS — and copy the whole map into `tenants.settings`, the
 * column every tenant API returns: each save undid the encryption at rest.
 * Nothing reads that copy (getTenantSettings takes `tenant_settings` first),
 * so it is no longer written; migration 0035 scrubs the secrets it holds.
 * A secret sent back as SECRET_SETTING_MASK — what a read returns for it —
 * means "unchanged" and is skipped, so a form that round-trips the masked
 * value cannot overwrite the real one with the mask.
 *
 * A-176: only the keys in constants/tenantAdminSettings are accepted, each
 * with a scalar value; anything else is a 400 naming the key. Retention,
 * legal hold, lifecycle, feature flags, network policy, OIDC clients and
 * storage are written only by their own gated endpoints.
 *
 * @param {string} tenantId - the tenant whose settings change
 * @param {object} settingsData - `{ settings: { key: value } }` and/or
 *   top-level key -> value (see settingEntries)
 * @param {string|null} updatedBy - the acting user id
 * @param {{userId?: (string|null), ipAddress?: (string|null),
 *   userAgent?: (string|null)}} [actor] - auditActor(req)
 * @returns {Promise<object>} the service envelope; data is every setting,
 *   secrets masked
 */
const updateTenantSettings = async (
  tenantId: TenantId,
  settingsData: Record<string, unknown> | null | undefined,
  updatedBy: string | null | undefined,
  actor: TenantActor = {},
): Promise<ServiceResult<Record<string, unknown>>> => {
  // A-176: before the transaction — a refused body opens nothing.
  assertTenantAdminSettings(settingEntries(settingsData));

  const transaction = await db.transaction();

  try {
    const tenant = await Tenants.findByPk(tenantId, { transaction });

    if (!tenant) {
      await transaction.rollback();
      throw new AppError(404, "Tenant not found");
    }

    // Upsert each setting
    const createdKeys: string[] = [];
    const changedKeys: string[] = [];
    for (const [key, value] of settingEntries(settingsData)) {
      if (isRedactedSettingKey(key) && value === SECRET_SETTING_MASK) {continue;}

      // eslint-disable-next-line @typescript-eslint/no-base-to-string -- as built: a scalar is stored as its string form (assertTenantAdminSettings allows only scalars and null)
      const stringValue = typeof value === "object" ? JSON.stringify(value) : String(value);

      await TenantSettings.findOrCreate({
        where: { tenantId, key },
        // findOrCreate merges `where` into `defaults`, so the row is created with its tenantId and key.
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- the defaults are the value only; Sequelize adds tenantId and key from `where`
        defaults: { value: stringValue } as CreationAttributes<ModelInstance<"TenantSettings">>,
        transaction,
      }).then(([setting, created]) => {
        if (created) {
          createdKeys.push(key);
          return setting;
        }
        if (setting.value !== stringValue) {
          changedKeys.push(key);
        }
        return setting.update({ value: stringValue }, { transaction });
      });
    }

    // Read back for the response (decrypted by the model, masked below).
    const allSettings = await TenantSettings.findAll({
      where: { tenantId },
      transaction,
    });

    const settingsJson: Record<string, unknown> = {};
    for (const s of allSettings) {
      settingsJson[s.key] = s.value;
    }

    // A-117: in the transaction; a failed insert throws and rolls it back.
    await auditService.logAction(
      {
        tenantId,
        // A-282 (ADR-100): an API key is system:api-key, its id in changes.
        ...auditEntryActor({ ...actor, userId: actor.userId || updatedBy || null }),
        action: "UPDATE",
        resourceType: "TenantSettings",
        resourceId: tenantId,
        changes: {
          operation: "UPDATE_SETTINGS",
          created: createdKeys,
          changed: changedKeys,
          ...actorChanges(actor),
        },
      },
      { transaction },
    );

    await transaction.commit();

    // Invalidate the settings cache. getTenantSettings no longer writes it
    // (A-150); this also clears an entry cached before that change.
    await del(cacheKeys.tenantSettings(tenantId));

    logger.info("Tenant settings updated", {
      tenantId,
      updatedBy,
      keys: settingEntries(settingsData).map(([key]) => key),
    });

    return {
      success: true,
      status: 200,
      message: "Tenant settings updated successfully",
      data: maskSecretSettings(settingsJson),
    };
  } catch (error) {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- as built: `transaction &&` guards a test double that resolves no transaction
    if (transaction && !(transaction as Transaction & { finished?: unknown }).finished) {
      // eslint-disable-next-line @typescript-eslint/no-empty-function -- as built: a failed rollback is ignored
      await transaction.rollback().catch(() => {});
    }
    logger.error("Error updating tenant settings", { error: (error as Thrown).message });
    throw error;
  }
};

// ------------------------------------------------------------------
// GET TENANT USER COUNT
// ------------------------------------------------------------------
const getTenantUserCount = async (
  tenantId: TenantId,
): Promise<
  ServiceResult<{
    tenantId: TenantId;
    userCount: number;
    limitSeats: number | null;
    remainingSlots: number | null;
    unlimited: boolean;
  } | null>
> => {
  try {
    const tenant = await Tenants.findByPk(tenantId);

    if (!tenant) {
      return {
        success: true,
        status: 404,
        message: "Tenant not found",
        data: null,
      };
    }

    const userCount = await Users.count({
      where: { tenantId },
    });

    // Seat limit: `limitSeats` is the single source. `maxUsers` was read here —
    // never an attribute, so the answer was `maxUsers: undefined` and
    // `remainingSlots: NaN`. Unlimited follows quota.service: a null or
    // negative limit; both numbers are then null.
    const limit = tenant.limitSeats;
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- as built: a row read without the column has `undefined`
    const unlimited = limit === null || limit === undefined || limit < 0;
    return {
      success: true,
      status: 200,
      message: "Fetch tenant user count successful",
      data: {
        tenantId,
        userCount,
        limitSeats: unlimited ? null : limit,
        remainingSlots: unlimited ? null : Math.max(0, limit - userCount),
        unlimited,
      },
    };
  } catch (error) {
    logger.error("Error fetching tenant user count", { error: (error as Thrown).message });
    throw new AppError(500, "Internal server error");
  }
};

const service = {
  fetchTenants,
  fetchSpecificTenant,
  getTenantByIdForMiddleware,
  getTenantByCodeForMiddleware,
  getPublicBranding,
  createTenant,
  updateTenant,
  deleteTenant,
  getTenantSettings,
  updateTenantSettings,
  getTenantUserCount,
};

export = service;
