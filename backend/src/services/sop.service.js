const { Op } = require("sequelize");
const {
  SopDocument,
  SopTrainingAcknowledgment,
  User,
} = require("../models");
// NOT `db` from the models barrel (that export is the registry's own handle) —
// the config module is what exports the Sequelize instance.
const { db } = require("../config");
const auditService = require("./audit.service");
const { AppError } = require("../utils/appError.util");

// A-28. Statuses from which an SOP can be released. PUBLISHED and ARCHIVED are
// terminal for this action and are reported as 409 state explanations.
const PUBLISHABLE_STATES = ["DRAFT", "UNDER_REVIEW"];

/** D-24 (ADR-070): users read, and acknowledgements inserted, this many at a time. */
const TRAINING_FANOUT_BATCH = 500;

/**
 * D-24 (ADR-070) — assign a published SOP's training to every user of the
 * tenant, a batch at a time. It used to read every user of the tenant into
 * memory and insert one acknowledgement per user in ONE statement — a
 * statement whose size, and whose bind-parameter count (PostgreSQL's limit is
 * 65,535), grew with the tenant. Now: keyset pages by id (stable while rows
 * are added), only the id selected, one bulkCreate per page, all inside the
 * publish's transaction — so the release is still all or nothing.
 *
 * @param {string} tenantId
 * @param {string} documentId
 * @param {object} transaction - the publish's transaction
 * @returns {Promise<number>} how many acknowledgements were assigned
 */
const assignTraining = async (tenantId, documentId, transaction) => {
  let assigned = 0;
  let afterId = null;
  for (;;) {
    const users = await User.findAll({
      where: afterId ? { tenantId, id: { [Op.gt]: afterId } } : { tenantId },
      attributes: ["id"],
      order: [["id", "ASC"]],
      limit: TRAINING_FANOUT_BATCH,
      transaction,
    });
    if (users.length > 0) {
      await SopTrainingAcknowledgment.bulkCreate(
        users.map((user) => ({ tenantId, documentId, userId: user.id, status: "PENDING" })),
        { transaction },
      );
      assigned += users.length;
    }
    if (users.length < TRAINING_FANOUT_BATCH) {
      return assigned;
    }
    afterId = users[users.length - 1].id;
  }
};

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
      // LEFT JOIN (A-90): User's defaultScope makes this INNER otherwise, and a
      // document whose author was deleted, or is outside the tenant (the super
      // admin authoring inside it), vanished from the list.
      { model: User, as: "author", attributes: ["id", "firstName", "lastName"], required: false },
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
exports.TRAINING_FANOUT_BATCH = TRAINING_FANOUT_BATCH;

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
      // A-28 in TASKS/AUDIT-2026-09-REMEDIATION.md. D-24: in batches.
      await assignTraining(tenantId, doc.id, transaction);
    }

    await auditService.logAction(
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

/**
 * Record that the caller has read an SOP — their ISO 13485 §6.2 training
 * record for that revision.
 *
 * A-145 — the acknowledgement and its audit row commit together, and a
 * completed acknowledgement is never rewritten. Until 2026-09-24 this saved
 * the row with no audit entry at all (an unattributable training record), and
 * a second click silently moved `acknowledgedAt` to "now" — the date the
 * training record attests could be changed after the fact. A repeat is now a
 * 409 that names the recorded date.
 *
 * The route carries denyPlatformAuthoring (ADR-051 Q-17): only the member
 * themselves may attest their own training.
 *
 * @param {string} tenantId
 * @param {string} userId - the caller; only their own acknowledgement is found
 * @param {string} documentId
 * @returns {Promise<object>} the completed acknowledgement
 * @throws {AppError} 404 when no training is assigned to the caller for this
 *   document in this tenant (another tenant's document reads the same); 409
 *   when it was already acknowledged
 */
exports.acknowledgeTraining = async (tenantId, userId, documentId) => {
  const ack = await SopTrainingAcknowledgment.findOne({
    where: { tenantId, userId, documentId },
  });

  if (!ack) {
    throw new AppError(404, "Training acknowledgment not found");
  }

  if (ack.status === "COMPLETED") {
    const when = ack.acknowledgedAt ? new Date(ack.acknowledgedAt).toISOString() : "an earlier date";
    throw new AppError(
      409,
      `You already acknowledged this SOP on ${when}. A training record is not overwritten; if the procedure changed, a new revision must be published and acknowledged.`,
    );
  }

  const previousStatus = ack.status;

  await db.transaction(async (transaction) => {
    ack.status = "COMPLETED";
    ack.acknowledgedAt = new Date();
    await ack.save({ transaction });

    await auditService.logAction(
      {
        tenantId,
        userId,
        // No ENUM member of its own: the nearest action, with the operation
        // named in `changes` (constants/auditActions.js).
        action: "UPDATE",
        resourceType: "SopTrainingAcknowledgment",
        resourceId: ack.id,
        changes: {
          operation: "ACKNOWLEDGE_TRAINING",
          documentId,
          before: { status: previousStatus },
          after: { status: "COMPLETED", acknowledgedAt: ack.acknowledgedAt },
        },
      },
      { transaction },
    );
  });

  return ack;
};
