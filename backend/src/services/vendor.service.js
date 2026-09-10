const { Op } = require("sequelize");
const { db } = require("../config");
const { Vendors } = require("../models");
const { AppError } = require("../utils/appError.util");
const { DEFAULT_LIMIT, MAX_LIMIT } = require("../constants");
const { get, set, delPattern, cacheKeys } = require("./redis.service");

// ------------------------------------------------------------------
// HELPERS
// ------------------------------------------------------------------
const transformVendor = (vendor) => {
  if (!vendor) return null;
  return vendor.toJSON ? vendor.toJSON() : { ...vendor };
};

const transformVendors = (rows) => (rows || []).map(transformVendor);

// ------------------------------------------------------------------
// GET ALL VENDORS
// ------------------------------------------------------------------
exports.fetchVendors = async ({
  tenantId,
  find,
  page = 1,
  limit = DEFAULT_LIMIT,
  status,
  type,
}) => {
  try {
    const whereClause = { tenantId };

    if (find) {
      whereClause.name = { [Op.like]: `%${find}%` };
    }
    if (status) {
      whereClause.status = status;
    }
    if (type) {
      whereClause.type = type;
    }

    const safeLimit = Math.min(Number(limit) || DEFAULT_LIMIT, MAX_LIMIT);
    const offset = (Number(page) - 1) * safeLimit;

    const { count, rows } = await Vendors.findAndCountAll({
      where: whereClause,
      limit: safeLimit,
      offset,
      order: [["createdAt", "DESC"]],
    });

    return {
      success: true,
      status: 200,
      message: "Fetch vendors successful",
      data: {
        rows: transformVendors(rows),
        count,
        meta: {
          total: count,
          page: Number(page),
          limit: safeLimit,
          totalPages: Math.ceil(count / safeLimit),
        },
      },
    };
  } catch (error) {
    throw {
      status: error.status || 500,
      message: error.message || "Failed to fetch vendors",
    };
  }
};

// ------------------------------------------------------------------
// GET SPECIFIC VENDOR
// ------------------------------------------------------------------
exports.getVendorById = async (tenantId, vendorId) => {
  try {
    const vendor = await Vendors.findOne({
      where: { id: vendorId, tenantId },
    });

    if (!vendor) {
      throw new AppError(404, "Vendor not found");
    }

    return {
      success: true,
      status: 200,
      message: "Vendor retrieved successfully",
      data: transformVendor(vendor),
    };
  } catch (error) {
    throw {
      status: error.status || 500,
      message: error.message || "Failed to retrieve vendor",
    };
  }
};

// ------------------------------------------------------------------
// CREATE VENDOR
// ------------------------------------------------------------------
exports.createVendor = async (tenantId, data) => {
  try {
    const newVendor = await Vendors.create({
      ...data,
      tenantId,
    });

    return {
      success: true,
      status: 201,
      message: "Vendor created successfully",
      data: transformVendor(newVendor),
    };
  } catch (error) {
    throw {
      status: error.status || 500,
      message: error.message || "Failed to create vendor",
    };
  }
};

// ------------------------------------------------------------------
// UPDATE VENDOR
// ------------------------------------------------------------------
exports.updateVendor = async (tenantId, vendorId, data) => {
  try {
    const vendor = await Vendors.findOne({
      where: { id: vendorId, tenantId },
    });

    if (!vendor) {
      throw new AppError(404, "Vendor not found");
    }

    await vendor.update(data);

    return {
      success: true,
      status: 200,
      message: "Vendor updated successfully",
      data: transformVendor(vendor),
    };
  } catch (error) {
    throw {
      status: error.status || 500,
      message: error.message || "Failed to update vendor",
    };
  }
};

// ------------------------------------------------------------------
// DELETE VENDOR
// ------------------------------------------------------------------
exports.deleteVendor = async (tenantId, vendorId) => {
  try {
    const vendor = await Vendors.findOne({
      where: { id: vendorId, tenantId },
    });

    if (!vendor) {
      throw new AppError(404, "Vendor not found");
    }

    await vendor.destroy();

    return {
      success: true,
      status: 200,
      message: "Vendor deleted successfully",
    };
  } catch (error) {
    throw {
      status: error.status || 500,
      message: error.message || "Failed to delete vendor",
    };
  }
};

// ------------------------------------------------------------------
// QUALIFY VENDOR
// ------------------------------------------------------------------
exports.qualifyVendor = async ({ tenantId, id, approvalStatus, scorecard, lastAuditDate, nextAuditDate }) => {
  try {
    const vendor = await Vendors.findOne({
      where: { id, tenantId },
    });

    if (!vendor) {
      throw new AppError(404, "Vendor not found");
    }

    if (approvalStatus) vendor.approvalStatus = approvalStatus;
    if (scorecard !== undefined) vendor.scorecard = scorecard;
    if (lastAuditDate) vendor.lastAuditDate = lastAuditDate;
    if (nextAuditDate) vendor.nextAuditDate = nextAuditDate;

    await vendor.save();

    return transformVendor(vendor);
  } catch (error) {
    throw {
      status: error.status || 500,
      message: error.message || "Failed to qualify vendor",
    };
  }
};
