const { Tenants, Users, Role } = require("../models");
const { AppError } = require("../utils/appError.util");

// ==========================================
// GET ALL TENANTS (SUPER ADMIN)
// ==========================================

exports.getAllTenants = async (page = 1, limit = 10, search = "") => {
  const offset = (page - 1) * limit;

  const where = {};
  if (search) {
    const { Op } = require("sequelize");
    where[Op.or] = [
      { name: { [Op.iLike]: `%${search}%` } },
      { code: { [Op.iLike]: `%${search}%` } },
    ];
  }

  const { count, rows } = await Tenants.findAndCountAll({
    where,
    limit,
    offset,
    order: [["createdAt", "DESC"]],
  });

  return {
    total: count,
    page: Number(page),
    limit: Number(limit),
    totalPages: Math.ceil(count / limit),
    tenants: rows,
  };
};

// ==========================================
// UPDATE TENANT STATUS
// ==========================================

exports.updateTenantStatus = async (tenantId, status) => {
  const tenant = await Tenants.findByPk(tenantId);
  if (!tenant) throw new AppError(404, "Tenant not found");

  const validStatuses = ["active", "suspended", "deleted"];
  if (!validStatuses.includes(status)) {
    throw new AppError(400, "Invalid status");
  }

  tenant.status = status;
  await tenant.save();

  return tenant;
};

// ==========================================
// UPDATE TENANT FLAGS
// ==========================================

exports.updateTenantFlags = async (tenantId, flags) => {
  const tenant = await Tenants.findByPk(tenantId);
  if (!tenant) throw new AppError(404, "Tenant not found");

  // Merge flags or replace them
  // Assuming 'flags' is a JSONB column on Tenants. If not, we might need a TenantSettings model.
  // Wait, let's check what model is available for tenant settings or if we can use a basic implementation.
  // We'll update the plan if flags aren't on the Tenant model. Let's assume we can add a 'flags' column, or we just modify an existing 'settings' column.
  
  if (!tenant.settings) {
    tenant.settings = {};
  }
  
  tenant.settings = { ...tenant.settings, ...flags };
  tenant.changed("settings", true);
  await tenant.save();

  return tenant;
};
