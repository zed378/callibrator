const { NonConformance, Capa, User, CalibrationDevice } = require("../models");
const { AppError } = require("../utils/appError.util");

// ==========================================
// NON-CONFORMANCE
// ==========================================

exports.createNC = async (tenantId, reportedBy, data) => {
  const { title, description, severity, deviceId, dateIdentified } = data;
  
  // Generate NC Number
  const ncCount = await NonConformance.count({ where: { tenantId } });
  const ncNumber = `NC-${String(ncCount + 1).padStart(5, "0")}`;

  return NonConformance.create({
    tenantId,
    reportedBy,
    ncNumber,
    title,
    description,
    severity: severity || "MEDIUM",
    deviceId,
    dateIdentified: dateIdentified || new Date(),
    status: "OPEN",
  });
};

exports.getNCs = async (tenantId, page = 1, limit = 10, status) => {
  const offset = (page - 1) * limit;
  const where = { tenantId };
  if (status) where.status = status;

  const { count, rows } = await NonConformance.findAndCountAll({
    where,
    limit,
    offset,
    include: [
      { model: User, as: "reporter", attributes: ["id", "firstName", "lastName", "email"] },
      { model: CalibrationDevice, as: "device", attributes: ["id", "name", "serialNumber"] },
    ],
    order: [["createdAt", "DESC"]],
  });

  return {
    total: count,
    page: Number(page),
    limit: Number(limit),
    totalPages: Math.ceil(count / limit),
    nonConformances: rows,
  };
};

exports.updateNC = async (tenantId, ncId, data) => {
  const nc = await NonConformance.findOne({ where: { id: ncId, tenantId } });
  if (!nc) throw new AppError(404, "Non-Conformance not found");

  const allowedUpdates = ["title", "description", "status", "severity", "rootCause"];
  allowedUpdates.forEach((field) => {
    if (data[field] !== undefined) nc[field] = data[field];
  });

  await nc.save();
  return nc;
};

// ==========================================
// CAPA
// ==========================================

exports.createCapa = async (tenantId, data) => {
  const { ncId, title, actionPlan, assignedTo, dueDate } = data;
  
  const nc = await NonConformance.findOne({ where: { id: ncId, tenantId } });
  if (!nc) throw new AppError(404, "Non-Conformance not found");

  const capaCount = await Capa.count({ where: { tenantId } });
  const capaNumber = `CAPA-${String(capaCount + 1).padStart(5, "0")}`;

  return Capa.create({
    tenantId,
    capaNumber,
    ncId,
    title,
    actionPlan,
    assignedTo,
    dueDate,
    status: "DRAFT",
  });
};

exports.getCapas = async (tenantId, page = 1, limit = 10, status) => {
  const offset = (page - 1) * limit;
  const where = { tenantId };
  if (status) where.status = status;

  const { count, rows } = await Capa.findAndCountAll({
    where,
    limit,
    offset,
    include: [
      { model: NonConformance, as: "nonConformance", attributes: ["id", "ncNumber", "title"] },
      { model: User, as: "assignee", attributes: ["id", "firstName", "lastName", "email"] },
    ],
    order: [["createdAt", "DESC"]],
  });

  return {
    total: count,
    page: Number(page),
    limit: Number(limit),
    totalPages: Math.ceil(count / limit),
    capas: rows,
  };
};

exports.updateCapa = async (tenantId, capaId, data) => {
  const capa = await Capa.findOne({ where: { id: capaId, tenantId } });
  if (!capa) throw new AppError(404, "CAPA not found");

  const allowedUpdates = ["title", "actionPlan", "status", "assignedTo", "dueDate", "completedDate", "approvedBy", "verificationNotes"];
  allowedUpdates.forEach((field) => {
    if (data[field] !== undefined) capa[field] = data[field];
  });

  await capa.save();
  return capa;
};
