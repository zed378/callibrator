// src/services/tenant.service.js
const { Op } = require("sequelize");
const { db } = require("../config");
const { Tenants, Users } = require("../models");
const { logger } = require("../middlewares/activityLog.middleware");
const { AppError } = require("../utils/appError.util");
const { DEFAULT_LIMIT, MAX_LIMIT } = require("../constants");
const { deleteUpload } = require("../utils/upload.util");
const {
  validate: validateInput,
  formatErrors,
  createTenantSchema,
  updateTenantSchema,
} = require("../validators/tenant.validator");
const { get, set, del, delPattern, cacheKeys } = require("./redis.service");
const auditService = require("./audit.service");
const { PLATFORM_TENANT_ID } = require("../constants/platformTenant");

// ==========================================
// VALIDATION HELPERS
// ==========================================

/**
 * Validate input data against a schema
 * @param {Object} data - Data to validate
 * @param {Object} schema - Joi schema
 * @returns {Object} - Validated and sanitized data
 */
const validate = (data, schema) => {
  return validateInput(data, schema);
};

// ------------------------------------------------------------------
// Constants
// ------------------------------------------------------------------

const safeTenantAttributes = {
  exclude: ["updatedAt", "createdBy"],
};

const { TenantSettings } = require("../models");
const { DEFAULT_UPLOAD_PLACEHOLDER } = require("../constants/appConstants");

const TENANT_LOGO_BASE_URL = `${process.env.HOST_URL || "http://localhost:5000"}/uploads/tenant`;

/**
 * Build the public URL for a tenant logo.
 *
 * DEFAULT_UPLOAD_PLACEHOLDER means "no logo uploaded" — the same sentinel the
 * replace paths below already refuse to unlink. Building a URL from it yields
 * /uploads/tenant/default.svg, which 404s: nothing ships that file, and
 * /app/uploads is a volume that would shadow it. Null lets the UI fall back.
 *
 * @param {string|null|undefined} logo - the stored filename
 * @returns {string|null} the public URL, or null when there is no real logo
 */
const logoUrl = (logo) =>
  !logo || logo === DEFAULT_UPLOAD_PLACEHOLDER
    ? null
    : `${TENANT_LOGO_BASE_URL}/${logo}`;

/**
 * Transform tenant instance to plain object with logo baseUrl
 * @param {Object} tenant - Sequelize tenant instance
 * @returns {Object} - Transformed tenant data
 */
const transformTenant = (tenant) => {
  /* istanbul ignore if -- defensive: every caller passes a loaded row (each
     returns 404 or throws first). Its only exercised null path was
     createTenant's after a null insert, which since A-95 throws in the audit
     row, before the commit and before this is reached. */
  if (!tenant) {return null;}
  const data = tenant.toJSON ? tenant.toJSON() : { ...tenant };
  data.logoBaseUrl = logoUrl(data.logo);
  return data;
};

/**
 * Transform tenant rows array with logo baseUrl
 * @param {Array} rows - Array of Sequelize tenant instances
 * @returns {Array} - Transformed tenant data
 */
/* istanbul ignore next -- unreachable: transformTenants is never referenced by
   any call site in this module or elsewhere in the codebase (dead helper kept
   alongside transformTenant); it cannot be invoked from a test. */
const transformTenants = (rows) => {
  return (rows || []).map(transformTenant);
};

// ------------------------------------------------------------------
// GET ALL TENANTS
// ------------------------------------------------------------------
exports.fetchTenants = async ({ find, page = 1, limit = DEFAULT_LIMIT }) => {
  try {
    // Only cache simple fetches (no search, paginated)
    const shouldCache = !find && Number(page) === 1;

    if (shouldCache) {
      const cacheKey = `tenants:page:1:limit:${limit}`;
      const cached = await get(cacheKey);
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

    const whereClause = {};

    // Free-text search (case-insensitive - MySQL compatible)
    if (find) {
      const searchTerm = `%${find.toLowerCase()}%`;
      whereClause[Op.or] = [
        { name: { [Op.like]: searchTerm } },
        { code: { [Op.like]: searchTerm } },
        { description: { [Op.like]: searchTerm } },
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
    const userCounts = await Users.findAll({
      attributes: [
        ["tenant_id", "id"],
        [db.sequelize.fn("COUNT", "*"), "count"],
      ],
      where: { tenantId: tenantRows.map((t) => t.id) },
      group: ["tenant_id"],
      raw: true,
    });

    const countMap = userCounts.reduce((acc, row) => {
      acc[row.id] = parseInt(row.count, 10);
      return acc;
    }, {});

    // Transform tenants to include logoBaseUrl and user count
    const transformedRows = tenantRows.map((tenant) => {
      const data = tenant.toJSON ? tenant.toJSON() : { ...tenant };
      data.logoBaseUrl = logoUrl(data.logo);
      data.userCount = countMap[data.id] || 0;
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

    // Cache first page only for 5 minutes
    if (shouldCache) {
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
    logger.error("Error fetching tenants", {
      error: error.message,
      stack: error.stack,
    });
    throw {
      status: error.status || 500,
      message: error.message || "Internal server error",
    };
  }
};

// ------------------------------------------------------------------
// GET SPECIFIC TENANT
// ------------------------------------------------------------------
exports.fetchSpecificTenant = async (tenantId) => {
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
    logger.error("Error fetching specific tenant", { error: error.message });
    throw new AppError(500, "Internal server error");
  }
};

// ------------------------------------------------------------------
// MIDDLEWARE HELPERS (No ORM leak in middlewares)
// ------------------------------------------------------------------
exports.getTenantByIdForMiddleware = async (tenantId) => {
  return await Tenants.findByPk(tenantId, {
    attributes: ["id", "name", "status"],
  });
};

exports.getTenantByCodeForMiddleware = async (tenantCode) => {
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
exports.getPublicBranding = async (tenantId) => {
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
 */
exports.createTenant = async (input, createdBy, actor = {}) => {
  // Validate input
  const data = validate(input, createTenantSchema);
  const {
    name,
    code,
    description,
    logo,
    primaryColor,
    maxUsers,
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
      .toString()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 63) || code.toString().toLowerCase();
  const tenantEmail = email || `${subdomain}@example.com`;

  const transaction = await db.transaction();

  try {
    // Check if code already exists
    const existingCode = await Tenants.findOne({
      where: { code },
      transaction,
    });

    if (existingCode) {
      await transaction.rollback();
      throw new AppError(409, "Tenant code already exists");
    }

    // Check if name already exists
    const existingName = await Tenants.findOne({
      where: { name },
      transaction,
    });

    if (existingName) {
      await transaction.rollback();
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
        maxUsers: maxUsers || 10,
        email: tenantEmail,
        phone: phone || null,
        address: address || null,
        city: city || null,
        state: state || null,
        zipCode: zipCode || null,
        country: country || null,
        website: website || null,
        createdBy,
      },
      { transaction },
    );

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
          after: { name: tenant.name, code: tenant.code, subdomain: tenant.subdomain },
        },
        ipAddress: actor.ipAddress || null,
        userAgent: actor.userAgent || null,
      },
      { transaction },
    );

    await transaction.commit();

    // Transform tenant to include logoBaseUrl
    const transformedTenant = transformTenant(tenant);

    // Cache new tenant by ID and code
    await set(cacheKeys.tenant(tenant.id), transformedTenant, 600);
    await set(cacheKeys.tenantByCode(code), transformedTenant, 600);

    // Invalidate tenant list cache
    await delPattern("tenants:*");

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
    // Only rollback if transaction is still active (not finished)
    if (transaction && !transaction.finished) {
      await transaction.rollback().catch(() => {
        // Ignore rollback errors if transaction is already finished
      });
    }
    logger.error("Error creating tenant", { error: error.message });
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
 *    auth.middleware.js, including whoever set it, and recovery then needs a
 *    super admin. The platform already owns this transition
 *    (PATCH /admin/tenants/:id/status, super-admin only).
 *  - `maxUsers` — the tenant's seat limit (`getTenantUserCount` answers
 *    `remainingSlots` from it). A tenant raising its own limit is a tenant
 *    granting itself capacity it has not been given.
 *
 * So only a super admin may CHANGE them. A non-super-admin resubmitting the
 * current value (a form that posts every field) is not a change and passes.
 */
const PLATFORM_CONTROLLED_FIELDS = Object.freeze(["status", "maxUsers"]);

/**
 * The platform-controlled fields `data` would actually change on `tenant`.
 *
 * @param {object} tenant - the loaded row
 * @param {{status?: string, maxUsers?: number}} data - validated input
 * @returns {string[]} the names of the fields that would change
 */
const platformFieldChanges = (tenant, { status, maxUsers }) => {
  const changed = [];
  // `status || tenant.status` below: an empty or null status is "no change".
  if (status && String(status).toUpperCase() !== String(tenant.status).toUpperCase()) {
    changed.push("status");
  }
  if (maxUsers !== undefined && Number(maxUsers) !== Number(tenant.maxUsers)) {
    changed.push("maxUsers");
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
]);

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
exports.updateTenant = async (tenantId, input, updatedBy, actor = {}) => {
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
    maxUsers,
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
      String(tenant.id) !== String(actor.tenantId);
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

    const before = {};
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
        status: status || tenant.status,
        maxUsers: maxUsers !== undefined ? maxUsers : tenant.maxUsers,
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
    const changes = {};
    for (const field of AUDITED_TENANT_FIELDS) {
      if (tenant[field] !== before[field]) {
        changes[field] = { before: before[field], after: tenant[field] };
      }
    }
    await auditService.logAction(
      {
        tenantId: tenant.id,
        userId: updatedBy || null,
        action: "UPDATE",
        resourceType: "Tenant",
        resourceId: tenant.id,
        changes,
        ipAddress: actor.ipAddress || null,
        userAgent: actor.userAgent || null,
      },
      { transaction },
    );

    await transaction.commit();

    if (replacedLogo && replacedLogo !== "default.svg") {
      try {
        await deleteUpload(replacedLogo, "uploads/tenant");
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
    if (transaction && !transaction.finished) {
      await transaction.rollback().catch(() => {
        // Ignore rollback errors if transaction is already finished
      });
    }
    logger.error("Error updating tenant", { error: error.message });
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
exports.deleteTenant = async (tenantId, actor = {}) => {
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
        `Cannot delete tenant with ${userCount} active user(s). Please remove or reassign users first.`,
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
          await deleteUpload(logoFilename, "uploads/tenant");
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
    if (transaction && !transaction.finished) {
      await transaction.rollback().catch(() => {
        // Ignore rollback errors if transaction is already finished
      });
    }
    logger.error("Error deleting tenant", { error: error.message });
    throw error;
  }
};

// ------------------------------------------------------------------
// GET TENANT SETTINGS
// ------------------------------------------------------------------
exports.getTenantSettings = async (tenantId) => {
  try {
    // Try cache first
    const cacheKey = cacheKeys.tenantSettings(tenantId);
    const cached = await get(cacheKey);
    if (cached) {
      return {
        success: true,
        status: 200,
        message: "Fetch tenant settings successful (cached)",
        data: cached,
      };
    }

    const tenant = await Tenants.findByPk(tenantId);

    if (!tenant) {
      return {
        success: true,
        status: 404,
        message: "Tenant not found",
        data: null,
      };
    }

    const settings = {};

    // 1. Load from TenantSettings key-value table
    const dbSettings = await TenantSettings.findAll({
      where: { tenantId },
    });
    for (const s of dbSettings) {
      settings[s.key] = s.value;
    }

    // 2. Merge/fallback from JSONB settings column on Tenant model
    const rawSettings = tenant.settings;
    if (rawSettings && typeof rawSettings === "object") {
      for (const [key, val] of Object.entries(rawSettings)) {
        if (settings[key] === undefined) {
          settings[key] = val;
        }
      }
    }

    const result = { tenant, settings };

    // Cache for 15 minutes
    await set(cacheKey, result, 900);

    return {
      success: true,
      status: 200,
      message: "Fetch tenant settings successful",
      data: result,
    };
  } catch (error) {
    logger.error("Error fetching tenant settings", { error: error.message });
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
 * @param {string} tenantId - the tenant whose settings change
 * @param {object} settingsData - key -> value
 * @param {string|null} updatedBy - the acting user id
 * @param {{userId?: (string|null), ipAddress?: (string|null),
 *   userAgent?: (string|null)}} [actor] - auditActor(req)
 */
exports.updateTenantSettings = async (tenantId, settingsData, updatedBy, actor = {}) => {
  const transaction = await db.transaction();

  try {
    const tenant = await Tenants.findByPk(tenantId, { transaction });

    if (!tenant) {
      await transaction.rollback();
      throw new AppError(404, "Tenant not found");
    }

    // Upsert each setting, skipping internal properties
    const createdKeys = [];
    const changedKeys = [];
    for (const [key, value] of Object.entries(settingsData)) {
      if (key === "tenantId" || key === "settings") {continue;}

      const stringValue = typeof value === "object" ? JSON.stringify(value) : String(value);

      await TenantSettings.findOrCreate({
        where: { tenantId, key },
        defaults: { value: stringValue },
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

    // Fetch all settings to sync back to JSONB column
    const allSettings = await TenantSettings.findAll({
      where: { tenantId },
      transaction,
    });

    const settingsJson = {};
    for (const s of allSettings) {
      settingsJson[s.key] = s.value;
    }

    // Keep the JSONB settings column updated on the Tenant record
    await tenant.update({ settings: settingsJson }, { transaction });

    // A-117: in the transaction; a failed insert throws and rolls it back.
    await auditService.logAction(
      {
        tenantId,
        userId: actor.userId || updatedBy || null,
        action: "UPDATE",
        resourceType: "TenantSettings",
        resourceId: tenantId,
        changes: {
          operation: "UPDATE_SETTINGS",
          created: createdKeys,
          changed: changedKeys,
        },
        ipAddress: actor.ipAddress || null,
        userAgent: actor.userAgent || null,
      },
      { transaction },
    );

    await transaction.commit();

    // Invalidate settings cache
    await del(cacheKeys.tenantSettings(tenantId));

    logger.info("Tenant settings updated", {
      tenantId,
      updatedBy,
      keys: Object.keys(settingsData),
    });

    return {
      success: true,
      status: 200,
      message: "Tenant settings updated successfully",
      data: settingsJson,
    };
  } catch (error) {
    if (transaction && !transaction.finished) {
      await transaction.rollback().catch(() => {});
    }
    logger.error("Error updating tenant settings", { error: error.message });
    throw error;
  }
};

// ------------------------------------------------------------------
// GET TENANT USER COUNT
// ------------------------------------------------------------------
exports.getTenantUserCount = async (tenantId) => {
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

    return {
      success: true,
      status: 200,
      message: "Fetch tenant user count successful",
      data: {
        tenantId,
        userCount,
        maxUsers: tenant.maxUsers,
        remainingSlots: Math.max(0, tenant.maxUsers - userCount),
      },
    };
  } catch (error) {
    logger.error("Error fetching tenant user count", { error: error.message });
    throw new AppError(500, "Internal server error");
  }
};
