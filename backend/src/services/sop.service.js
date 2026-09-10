const { SopDocument, SopTrainingAcknowledgment, User } = require("../models");
const { AppError } = require("../utils/appError.util");

exports.createDocument = async (tenantId, authorId, data) => {
  const { title, version, contentUrl, requiresTraining } = data;
  
  const docCount = await SopDocument.count({ where: { tenantId } });
  const documentNumber = `SOP-${String(docCount + 1).padStart(4, "0")}`;

  return SopDocument.create({
    tenantId,
    authorId,
    documentNumber,
    title,
    version: version || "1.0",
    contentUrl,
    requiresTraining: requiresTraining !== undefined ? requiresTraining : true,
    status: "DRAFT",
  });
};

exports.getDocuments = async (tenantId, page = 1, limit = 10, status) => {
  const offset = (page - 1) * limit;
  const where = { tenantId };
  if (status) where.status = status;

  const { count, rows } = await SopDocument.findAndCountAll({
    where,
    limit,
    offset,
    include: [
      { model: User, as: "author", attributes: ["id", "firstName", "lastName"] },
    ],
    order: [["createdAt", "DESC"]],
  });

  return {
    total: count,
    page: Number(page),
    limit: Number(limit),
    totalPages: Math.ceil(count / limit),
    documents: rows,
  };
};

exports.publishDocument = async (tenantId, documentId) => {
  const doc = await SopDocument.findOne({ where: { id: documentId, tenantId } });
  if (!doc) throw new AppError(404, "Document not found");

  doc.status = "PUBLISHED";
  doc.publishedDate = new Date();
  await doc.save();

  if (doc.requiresTraining) {
    // Generate acknowledgments for all users in the tenant
    // In a real app, this might be filtered by role or department
    const users = await User.findAll({ where: { tenantId } });
    const acks = users.map(user => ({
      tenantId,
      documentId: doc.id,
      userId: user.id,
      status: "PENDING"
    }));
    await SopTrainingAcknowledgment.bulkCreate(acks);
  }

  return doc;
};

exports.acknowledgeTraining = async (tenantId, userId, documentId) => {
  const ack = await SopTrainingAcknowledgment.findOne({
    where: { tenantId, userId, documentId }
  });

  if (!ack) {
    // If not required or generated, let's assume valid
    throw new AppError(404, "Training acknowledgment not found");
  }

  ack.status = "COMPLETED";
  ack.acknowledgedAt = new Date();
  await ack.save();

  return ack;
};
