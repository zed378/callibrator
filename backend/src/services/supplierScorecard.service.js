const { SupplierScorecard, Vendor, User } = require("../models");
const { AppError } = require("../utils/appError.util");

exports.createScorecard = async (tenantId, data, userId) => {
  const vendor = await Vendor.findOne({ where: { id: data.vendorId, tenantId } });
  if (!vendor) throw new AppError(404, "Vendor not found");

  return await SupplierScorecard.create({
    ...data,
    tenantId,
    evaluatedBy: userId,
  });
};

exports.getScorecards = async (tenantId, query) => {
  const { limit = 10, page = 1, vendorId, status } = query;
  const offset = (page - 1) * limit;

  const where = { tenantId };
  if (vendorId) where.vendorId = vendorId;
  if (status) where.status = status;

  const { count, rows } = await SupplierScorecard.findAndCountAll({
    where,
    limit: parseInt(limit),
    offset: parseInt(offset),
    order: [["evaluationDate", "DESC"]],
    include: [
      { model: Vendor, as: "vendor", attributes: ["id", "name"] },
      { model: User, as: "evaluator", attributes: ["id", "firstName", "lastName", "email"] }
    ]
  });

  return {
    rows,
    total: count,
    page: parseInt(page),
    totalPages: Math.ceil(count / limit)
  };
};

exports.getScorecardById = async (tenantId, id) => {
  const scorecard = await SupplierScorecard.findOne({
    where: { id, tenantId },
    include: [
      { model: Vendor, as: "vendor", attributes: ["id", "name"] },
      { model: User, as: "evaluator", attributes: ["id", "firstName", "lastName", "email"] }
    ]
  });
  if (!scorecard) throw new AppError(404, "Scorecard not found");
  return scorecard;
};

exports.updateScorecard = async (tenantId, id, data) => {
  const scorecard = await this.getScorecardById(tenantId, id);
  await scorecard.update(data);
  return scorecard;
};

exports.deleteScorecard = async (tenantId, id) => {
  const scorecard = await this.getScorecardById(tenantId, id);
  await scorecard.destroy();
  return true;
};
