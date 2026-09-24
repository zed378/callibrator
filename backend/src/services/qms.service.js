const { NonConformance, Capa, User, CalibrationDevice } = require("../models");
// NOT `db` from the models barrel (that export is the registry's own handle) —
// the config module is what exports the Sequelize instance.
const { db } = require("../config");
const auditService = require("./audit.service");
const { AppError } = require("../utils/appError.util");
const { QMS_NUMBERING } = require("../constants/qmsConstants");

/**
 * A-66 — every QMS mutation writes its audit row inside the SAME transaction as
 * the change (the A-41 pattern, MEMORY/specs/A-41-audit-inside-transaction.md).
 * NCs and CAPAs are ISO 13485 §8.3/§8.5.2 quality records: a change committed
 * without its row is unattributable, and a row that outlives a rolled-back
 * change records something that never happened. `logAction` re-throws inside a
 * transaction, so a failed audit insert rolls the change back.
 *
 * `actor` is `utils/auditActor.util.js#auditActor(req)`:
 * `{ userId, ipAddress, userAgent }`. The audit row's tenant is the record's
 * tenant (the `tenantId` argument), never one taken from a request body.
 */
const audit = (transaction, tenantId, actor, action, resourceType, resourceId, changes) =>
  auditService.logAction(
    {
      tenantId,
      userId: actor.userId || null,
      action,
      resourceType,
      resourceId,
      changes,
      ipAddress: actor.ipAddress || null,
      userAgent: actor.userAgent || null,
    },
    { transaction },
  );

/**
 * A-73 — claim the next per-tenant NC / CAPA number.
 *
 * The number used to be `count() + 1`. Two concurrent creates read the same
 * count and issued the same number — a transaction does not serialise a
 * `count()` — and nothing stopped the duplicate. (A soft-deleted row also
 * dropped out of the count, so its number would have been re-issued.)
 *
 * Now the number comes from a per-tenant counter row in `qms_counters`
 * (migration 0024), claimed with one INSERT ... ON CONFLICT DO UPDATE. The
 * upsert takes the counter row's lock, which is held until this transaction
 * commits or rolls back, so a second create for the same tenant and kind waits
 * and then increments the committed value. A rolled-back create releases its
 * increment with it, so numbers stay gap-free under failure.
 *
 * The seed is the highest number already issued in the tenant (soft-deleted
 * rows included — raw SQL does not apply `paranoid`), and GREATEST keeps the
 * counter ahead of any number written by another path (a tenant restore, a
 * seed). The composite unique index (tenant_id, <number>) from 0024 is the
 * backstop: a collision that got past this would fail the INSERT, not
 * duplicate a quality-record identifier.
 *
 * RAW SQL bypasses the tenant hooks: both predicates carry `tenant_id`
 * explicitly, bound from the caller's tenant — never from a request body.
 * Table/column/prefix come from QMS_NUMBERING (code constants).
 *
 * @param {"NC"|"CAPA"} kind
 * @param {string} tenantId
 * @param {object} transaction - the create's transaction; the lock lives in it
 * @returns {Promise<string>} e.g. "NC-00042"
 */
const claimNumber = async (kind, tenantId, transaction) => {
  const { table, column, prefix } = QMS_NUMBERING[kind];
  const [rows] = await db.query(
    `INSERT INTO qms_counters (tenant_id, kind, seq, created_at, updated_at)
     VALUES (
       :tenantId,
       :kind,
       (SELECT COALESCE(MAX(CAST(SUBSTRING(${column} FROM :pattern) AS INTEGER)), 0)
          FROM ${table}
         WHERE tenant_id = :tenantId) + 1,
       NOW(),
       NOW()
     )
     ON CONFLICT (tenant_id, kind)
     DO UPDATE SET seq = GREATEST(qms_counters.seq + 1, EXCLUDED.seq), updated_at = NOW()
     RETURNING seq`,
    {
      // At most 9 digits, so the CAST cannot overflow INTEGER on a
      // hand-entered number; anything else is not a number this code issued.
      replacements: { tenantId, kind, pattern: `^${prefix}([0-9]{1,9})$` },
      transaction,
    },
  );
  return `${prefix}${String(rows[0].seq).padStart(5, "0")}`;
};

/**
 * A-75 — a referenced record must belong to the caller's tenant.
 *
 * The global tenant hooks would also scope this lookup, but they are skipped
 * for a super admin and for system context, and the record's tenant is the
 * `tenantId` argument — so the predicate is explicit. Another tenant's record,
 * a soft-deleted one (defaultScope) and a non-existent id are the same 404:
 * a distinguishable answer would be a cross-tenant existence oracle.
 */
const assertInTenant = async (Model, id, tenantId, transaction, notFound) => {
  const row = await Model.findOne({ where: { id, tenantId }, attributes: ["id"], transaction });
  if (!row) {throw new AppError(404, notFound);}
};

/**
 * A-75 — list includes.
 *
 * Measured against real Sequelize SQL generation (tests/services/
 * qms.includes.a75.test.js): the global tenant hooks put the predicate on the
 * ROOT model's WHERE only — an include gets none. And User/CalibrationDevice
 * carry a defaultScope `where`, which silently turned their includes into
 * INNER JOINs: an NC with no device, or a CAPA with no assignee, vanished from
 * the list. So every include is `required: false` (LEFT OUTER JOIN — the row
 * stays) with an explicit `tenantId` in its ON clause (a reference to another
 * tenant's row joins nothing, so none of its attributes are returned).
 */
const tenantInclude = (model, as, attributes, tenantId) => ({
  model,
  as,
  attributes,
  required: false,
  where: { tenantId },
});

/** The prior values of exactly the fields a PATCH is about to change. */
const pick = (record, fields) =>
  fields.reduce((out, field) => {
    out[field] = record[field] === undefined ? null : record[field];
    return out;
  }, {});

// ==========================================
// NON-CONFORMANCE
// ==========================================

/**
 * @param {string} tenantId
 * @param {string} reportedBy - the authenticated caller (req.user.id)
 * @param {object} data - request body
 * @param {object} [actor] - auditActor(req)
 * @returns {Promise<object>} the created NC
 */
exports.createNC = async (tenantId, reportedBy, data, actor = {}) => {
  const { title, description, severity, deviceId, dateIdentified, rootCause } = data;

  return db.transaction(async (transaction) => {
    if (deviceId) {
      await assertInTenant(CalibrationDevice, deviceId, tenantId, transaction, "Device not found");
    }

    const ncNumber = await claimNumber("NC", tenantId, transaction);

    const nc = await NonConformance.create(
      {
        tenantId,
        reportedBy,
        ncNumber,
        title,
        description,
        severity: severity || "MEDIUM",
        deviceId: deviceId || null,
        dateIdentified: dateIdentified || new Date(),
        rootCause: rootCause || null,
        status: "OPEN",
      },
      { transaction },
    );

    await audit(transaction, tenantId, { ...actor, userId: reportedBy }, "CREATE", "NonConformance", nc.id, {
      before: {},
      after: {
        ncNumber,
        title,
        severity: nc.severity,
        status: "OPEN",
        deviceId: deviceId || null,
      },
    });

    return nc;
  });
};

exports.getNCs = async (tenantId, page = 1, limit = 10, status) => {
  const offset = (page - 1) * limit;
  const where = { tenantId };
  if (status) {where.status = status;}

  const { count, rows } = await NonConformance.findAndCountAll({
    where,
    limit,
    offset,
    include: [
      tenantInclude(User, "reporter", ["id", "firstName", "lastName", "email"], tenantId),
      tenantInclude(CalibrationDevice, "device", ["id", "name", "serialNumber"], tenantId),
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

/**
 * @param {string} tenantId
 * @param {string} ncId
 * @param {object} data - validated PATCH body
 * @param {object} [actor] - auditActor(req)
 * @returns {Promise<object>} the updated NC
 */
exports.updateNC = async (tenantId, ncId, data, actor = {}) =>
  db.transaction(async (transaction) => {
    const nc = await NonConformance.findOne({ where: { id: ncId, tenantId }, transaction });
    if (!nc) {throw new AppError(404, "Non-Conformance not found");}

    const allowedUpdates = ["title", "description", "status", "severity", "rootCause"];
    const changed = allowedUpdates.filter((field) => data[field] !== undefined);
    const before = pick(nc, changed);
    changed.forEach((field) => {
      nc[field] = data[field];
    });

    await nc.save({ transaction });

    await audit(transaction, tenantId, actor, "UPDATE", "NonConformance", nc.id, {
      before,
      after: pick(nc, changed),
      ncNumber: nc.ncNumber,
    });

    return nc;
  });

// ==========================================
// CAPA
// ==========================================

/**
 * @param {string} tenantId
 * @param {object} data - request body
 * @param {object} [actor] - auditActor(req)
 * @returns {Promise<object>} the created CAPA
 */
exports.createCapa = async (tenantId, data, actor = {}) => {
  const { ncId, title, actionPlan, assignedTo, dueDate } = data;

  return db.transaction(async (transaction) => {
    const nc = await NonConformance.findOne({ where: { id: ncId, tenantId }, transaction });
    if (!nc) {throw new AppError(404, "Non-Conformance not found");}
    if (assignedTo) {
      await assertInTenant(User, assignedTo, tenantId, transaction, "Assignee not found");
    }

    const capaNumber = await claimNumber("CAPA", tenantId, transaction);

    const capa = await Capa.create(
      {
        tenantId,
        capaNumber,
        ncId,
        title,
        actionPlan,
        assignedTo: assignedTo || null,
        dueDate: dueDate || null,
        status: "DRAFT",
      },
      { transaction },
    );

    await audit(transaction, tenantId, actor, "CREATE", "Capa", capa.id, {
      before: {},
      after: {
        capaNumber,
        ncId,
        ncNumber: nc.ncNumber,
        title,
        status: "DRAFT",
        assignedTo: assignedTo || null,
        dueDate: dueDate || null,
      },
    });

    return capa;
  });
};

exports.getCapas = async (tenantId, page = 1, limit = 10, status) => {
  const offset = (page - 1) * limit;
  const where = { tenantId };
  if (status) {where.status = status;}

  const { count, rows } = await Capa.findAndCountAll({
    where,
    limit,
    offset,
    include: [
      tenantInclude(NonConformance, "nonConformance", ["id", "ncNumber", "title"], tenantId),
      tenantInclude(User, "assignee", ["id", "firstName", "lastName", "email"], tenantId),
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

/**
 * @param {string} tenantId
 * @param {string} capaId
 * @param {object} data - validated PATCH body
 * @param {object} [actor] - auditActor(req); `actor.userId` is the caller, and
 *   is who an approval records (A-62)
 * @returns {Promise<object>} the updated CAPA
 */
exports.updateCapa = async (tenantId, capaId, data, actor = {}) =>
  db.transaction(async (transaction) => {
    const capa = await Capa.findOne({ where: { id: capaId, tenantId }, transaction });
    if (!capa) {throw new AppError(404, "CAPA not found");}
    // A-75: a new assignee must be a user of this tenant (null unassigns).
    if (data.assignedTo) {
      await assertInTenant(User, data.assignedTo, tenantId, transaction, "Assignee not found");
    }

    // `approvedBy` is not in this list (A-62). The body used to name the
    // approver outright, so anyone could record a CAPA as approved by someone
    // else. The body's `approvedBy` now only says "record an approval": a value
    // records the CALLER, whatever id it names; `null` clears the approval.
    const allowedUpdates = ["title", "actionPlan", "status", "assignedTo", "dueDate", "completedDate", "verificationNotes"];
    const changed = allowedUpdates.filter((field) => data[field] !== undefined);
    if (data.approvedBy !== undefined) {changed.push("approvedBy");}
    const before = pick(capa, changed);

    allowedUpdates.forEach((field) => {
      if (data[field] !== undefined) {capa[field] = data[field];}
    });
    if (data.approvedBy !== undefined) {
      capa.approvedBy = data.approvedBy === null ? null : actor.userId || null;
    }

    await capa.save({ transaction });

    // Recording an approval is its own audit action, so an approval can be
    // found without reading every UPDATE's diff. Clearing one is an UPDATE.
    const approved = data.approvedBy !== undefined && data.approvedBy !== null;
    await audit(transaction, tenantId, actor, approved ? "APPROVE" : "UPDATE", "Capa", capa.id, {
      before,
      after: pick(capa, changed),
      capaNumber: capa.capaNumber,
    });

    return capa;
  });
