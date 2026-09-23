const {
  SopDocument,
  SopTrainingAcknowledgment,
  User,
  AuditLog,
} = require("../models");
// NOT `db` from the models barrel (that export is the registry's own handle) —
// the config module is what exports the Sequelize instance.
const { db } = require("../config");
const { AppError } = require("../utils/appError.util");

// A-28. Statuses from which an SOP can be released. PUBLISHED and ARCHIVED are
// terminal for this action and are reported as 409 state explanations.
const PUBLISHABLE_STATES = ["DRAFT", "UNDER_REVIEW"];

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
  if (status) {where.status = status;}

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

/**
 * Release a controlled procedure.
 *
 * A-28 — separation of duties. Until 2026-09-23 this set PUBLISHED with no
 * approver at all, and the only comment on the fan-out read "in a real app,
 * this might be filtered by role". An author could therefore write AND release
 * their own SOP, which ISO 13485 §4.2.4 document control and 21 CFR 11.10(d)
 * both forbid. The publisher must now be someone other than the author, and a
 * refusal is a 409 that names the state — not a 500 and not a generic error.
 *
 * The status change, the training fan-out and the audit row are written in one
 * transaction: a release recorded without its audit row is unattributable, and
 * an audit row that outlives a rolled-back release records a release that
 * never happened.
 *
 * @param {string} tenantId
 * @param {string} documentId
 * @param {string} publisherId - the authenticated caller releasing the SOP
 * @returns {Promise<object>} the published document
 */
exports.publishDocument = async (tenantId, documentId, publisherId) => {
  const doc = await SopDocument.findOne({ where: { id: documentId, tenantId } });
  if (!doc) {throw new AppError(404, "Document not found");}

  if (!PUBLISHABLE_STATES.includes(doc.status)) {
    throw new AppError(
      409,
      `SOP ${doc.documentNumber} is ${doc.status} and cannot be published. Only a DRAFT or UNDER_REVIEW document can be released; raise a new revision instead.`,
    );
  }

  if (String(doc.authorId) === String(publisherId)) {
    throw new AppError(
      409,
      `SOP ${doc.documentNumber} was authored by you and is still ${doc.status}. A controlled procedure must be released by someone other than its author — ask a second authorised user to publish it.`,
    );
  }

  const previousStatus = doc.status;

  await db.transaction(async (transaction) => {
    doc.status = "PUBLISHED";
    doc.publishedDate = new Date();
    await doc.save({ transaction });

    if (doc.requiresTraining) {
      // Fan the acknowledgment out to every user in the tenant. Narrowing this
      // by role or department is an open question, not a judgement call: see
      // A-28 in TASKS/AUDIT-2026-09-REMEDIATION.md.
      const users = await User.findAll({ where: { tenantId }, transaction });
      const acks = users.map(user => ({
        tenantId,
        documentId: doc.id,
        userId: user.id,
        status: "PENDING",
      }));
      await SopTrainingAcknowledgment.bulkCreate(acks, { transaction });
    }

    await AuditLog.create(
      {
        tenantId,
        userId: publisherId,
        action: "APPROVE",
        resourceType: "SopDocument",
        resourceId: doc.id,
        changes: {
          before: { status: previousStatus },
          after: { status: "PUBLISHED", publishedDate: doc.publishedDate },
          documentNumber: doc.documentNumber,
          version: doc.version,
          authorId: doc.authorId,
        },
      },
      { transaction },
    );
  });

  return doc;
};

exports.acknowledgeTraining = async (tenantId, userId, documentId) => {
  const ack = await SopTrainingAcknowledgment.findOne({
    where: { tenantId, userId, documentId },
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
