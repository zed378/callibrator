const { Risk, User } = require("../models");
const { AppError } = require("../utils/appError.util");

exports.createRisk = async (tenantId, data, userId) => {
  return await Risk.create({
    ...data,
    tenantId,
    identifiedBy: userId,
  });
};

exports.getRisks = async (tenantId, query) => {
  const { limit = 10, page = 1, status, category } = query;
  const offset = (page - 1) * limit;

  const where = { tenantId };
  if (status) where.status = status;
  if (category) where.category = category;

  const { count, rows } = await Risk.findAndCountAll({
    where,
    limit: parseInt(limit),
    offset: parseInt(offset),
    order: [["createdAt", "DESC"]],
    include: [
      { model: User, as: "identifier", attributes: ["id", "firstName", "lastName", "email"], required: false },
      { model: User, as: "assignee", attributes: ["id", "firstName", "lastName", "email"], required: false }
    ]
  });

  return {
    rows,
    total: count,
    page: parseInt(page),
    totalPages: Math.ceil(count / limit)
  };
};

exports.getRiskById = async (tenantId, id) => {
  const risk = await Risk.findOne({
    where: { id, tenantId },
    include: [
      { model: User, as: "identifier", attributes: ["id", "firstName", "lastName", "email"], required: false },
      { model: User, as: "assignee", attributes: ["id", "firstName", "lastName", "email"], required: false }
    ]
  });
  if (!risk) throw new AppError(404, "Risk not found");
  return risk;
};

exports.updateRisk = async (tenantId, id, data) => {
  const risk = await this.getRiskById(tenantId, id);
  await risk.update(data);
  return risk;
};

exports.deleteRisk = async (tenantId, id) => {
  const risk = await this.getRiskById(tenantId, id);
  await risk.destroy();
  return true;
};
