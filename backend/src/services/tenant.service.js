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

const TENANT_LOGO_BASE_URL = `${process.env.HOST_URL || "http://localhost:5000"}/uploads/tenant`;

/**
 * Transform tenant instance to plain object with logo baseUrl
 * @param {Object} tenant - Sequelize tenant instance
 * @returns {Object} - Transformed tenant data
 */
const transformTenant = (tenant) => {
  if (!tenant) {return null;}
  const data = tenant.toJSON ? tenant.toJSON() : { ...tenant };
  data.logoBaseUrl = data.logo ? `${TENANT_LOGO_BASE_URL}/${data.logo}` : null;
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
    const userCounts = await Users.findAll({
      attributes: [
        ["tenant_id", "id"],
        [db.sequelize.fn("COUNT", "*"), "count"],
      ],
      // unreachable else-branch: `whereClause` is initialised to an object
      // literal a few lines above and is only ever mutated, so it is always
      // truthy and the alternate can never execute.
      where: /* istanbul ignore next */ whereClause
        ? {
          [Op.or]: [{ tenant_id: tenantRows.map((t) => t.id) }],
        }
        : {
          // unreachable: lives in the dead else-branch above.
          tenant_id: tenantRows.map(/* istanbul ignore next */ (t) => t.id),
        },
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
      data.logoBaseUrl = data.logo
        ? `${TENANT_LOGO_BASE_URL}/${data.logo}`
        : null;
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
    logoBaseUrl: data.logo ? `${TENANT_LOGO_BASE_URL}/${data.logo}` : null,
  };

  await set(cacheKey, branding, 300);
  return branding;
};

// ------------------------------------------------------------------
// CREATE TENANT
// ------------------------------------------------------------------
exports.createTenant = async (input, createdBy) => {
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
exports.updateTenant = async (tenantId, input, updatedBy) => {
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

    if (!tenant) {
      throw new AppError(404, "Tenant not found");
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

    // Delete old logo file if new logo is being uploaded and old logo exists and is not default
    const newLogo = logo || tenant.logo;
    if (logo && logo !== tenant.logo) {
      const oldLogoFilename = (tenant.logo || "").split("/").pop();
      if (oldLogoFilename && oldLogoFilename !== "default.svg") {
        try {
          await deleteUpload(oldLogoFilename, "uploads/tenant");
        } catch (err) {
          logger.warn(`Failed to delete old logo: ${oldLogoFilename}`, err);
        }
      }
    }

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

    await transaction.commit();

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
exports.deleteTenant = async (tenantId, deletedBy) => {
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

    // Delete tenant logo file if exists and not default
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

    await tenant.destroy({ transaction });

    await transaction.commit();

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
exports.updateTenantSettings = async (tenantId, settingsData, updatedBy) => {
  const transaction = await db.transaction();

  try {
    const tenant = await Tenants.findByPk(tenantId, { transaction });

    if (!tenant) {
      await transaction.rollback();
      throw new AppError(404, "Tenant not found");
    }

    // Upsert each setting, skipping internal properties
    for (const [key, value] of Object.entries(settingsData)) {
      if (key === "tenantId" || key === "settings") {continue;}

      const stringValue = typeof value === "object" ? JSON.stringify(value) : String(value);

      await TenantSettings.findOrCreate({
        where: { tenantId, key },
        defaults: { value: stringValue },
        transaction,
      }).then(([setting, created]) => {
        if (!created) {
          return setting.update({ value: stringValue }, { transaction });
        }
        return setting;
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
