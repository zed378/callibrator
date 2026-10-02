/**
 * Quality management: non-conformances (NCs) and CAPAs — ISO 13485 §8.3 /
 * §8.5.2 quality records, numbered per tenant and audited in their
 * transactions.
 *
 * P9-16 (ADR-087, Stage C): converted from qms.service.js with no behaviour
 * change (its raw SQL moved to `sql()` first, as its own change). `export =`
 * keeps the exact object `require()` returned (the same keys, in the same
 * order). No method calls a sibling. The four models, `db`, `auditService`,
 * `AppError`, `QMS_NUMBERING`, `webhookService`, `WEBHOOK_EVENTS` and `sql`
 * are captured once at load, as the `.js` destructured them. webhook.service is
 * still JavaScript; its types come from the `.d.ts` beside it.
 */
import type { CreationAttributes, Transaction, WhereOptions } from "sequelize";
import models from "../models";
// NOT `db` from the models barrel (that export is the registry's own handle) —
// the config module is what exports the Sequelize instance.
import { db as loadedDb } from "../config";
import loadedAuditService from "./audit.service";
import { AppError as LoadedAppError } from "../utils/appError.util";
import { QMS_NUMBERING as LOADED_QMS_NUMBERING } from "../constants/qmsConstants";
import loadedWebhookService from "./webhook.service";
import { WEBHOOK_EVENTS as LOADED_WEBHOOK_EVENTS } from "../constants/webhookEvents";
import { sql as loadedSql, type SqlRunner } from "../utils/sql.util";
import type { AuditAction } from "../constants/auditActions";
import type { TenantId, UserId } from "../types/ids";
import type { ModelInstance } from "../types/models";

const { NonConformance, Capa, User, CalibrationDevice } = models;
const db = loadedDb;
const auditService = loadedAuditService;
const AppError = LoadedAppError;
const QMS_NUMBERING = LOADED_QMS_NUMBERING;
const webhookService = loadedWebhookService;
const WEBHOOK_EVENTS = LOADED_WEBHOOK_EVENTS;
const sql = loadedSql;

/** `db` as sql() takes it: the same object, viewed through the one method sql() calls. */
const dbRunner = db as unknown as SqlRunner;

type NcRow = ModelInstance<"NonConformance">;
type CapaRow = ModelInstance<"Capa">;

/** `utils/auditActor.util.js#auditActor(req)`: who acts, and from where. */
interface Actor {
  userId?: string | null;
  ipAddress?: string | null;
  // `string[]`: auditActor reads the raw user-agent header, which Node types as
  // possibly repeated (P9-20: a type-only widening; nothing emitted changes).
  userAgent?: string | string[] | null;
}

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
/* eslint-disable @typescript-eslint/prefer-nullish-coalescing -- as built (ADR-038 rule 3): an empty value is recorded as null */
const audit = (
  transaction: Transaction,
  tenantId: TenantId,
  actor: Actor,
  action: AuditAction,
  resourceType: string,
  resourceId: string,
  changes: Record<string, unknown>,
): Promise<unknown> =>
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
/* eslint-enable @typescript-eslint/prefer-nullish-coalescing */

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
 * P9-07: run through `sql()` — bind parameters only ($1 the tenant, $2 the
 * kind, $3 the pattern), `type: "SELECT"`, so the RETURNING rows come back as
 * the array. It used `replacements` (`:tenantId`), which `sql()` refuses.
 *
 * @param kind
 * @param tenantId
 * @param transaction - the create's transaction; the lock lives in it
 * @returns e.g. "NC-00042"
 */
const claimNumber = async (kind: "NC" | "CAPA", tenantId: TenantId, transaction: Transaction): Promise<string> => {
  const { table, column, prefix } = QMS_NUMBERING[kind];
  const rows = await sql<{ seq: number | string }>(
    dbRunner,
    `INSERT INTO qms_counters (tenant_id, kind, seq, created_at, updated_at)
     VALUES (
       $1,
       $2,
       (SELECT COALESCE(MAX(CAST(SUBSTRING(${column} FROM $3) AS INTEGER)), 0)
          FROM ${table}
         WHERE tenant_id = $1) + 1,
       NOW(),
       NOW()
     )
     ON CONFLICT (tenant_id, kind)
     DO UPDATE SET seq = GREATEST(qms_counters.seq + 1, EXCLUDED.seq), updated_at = NOW()
     RETURNING seq`,
    // At most 9 digits, so the CAST cannot overflow INTEGER on a
    // hand-entered number; anything else is not a number this code issued.
    [tenantId, kind, `^${prefix}([0-9]{1,9})$`],
    { transaction },
  );
  // The upsert always returns its row.
  return `${prefix}${String((rows[0] as { seq: number | string }).seq).padStart(5, "0")}`;
};

/** A model with the one lookup assertInTenant makes. */
interface TenantLookup {
  findOne(options: { where: WhereOptions; attributes: string[]; transaction: Transaction }): Promise<unknown>;
}

/**
 * A-75 — a referenced record must belong to the caller's tenant.
 *
 * The global tenant hooks would also scope this lookup, but they are skipped
 * for a super admin and for system context, and the record's tenant is the
 * `tenantId` argument — so the predicate is explicit. Another tenant's record,
 * a soft-deleted one (defaultScope) and a non-existent id are the same 404:
 * a distinguishable answer would be a cross-tenant existence oracle.
 */
const assertInTenant = async (Model: TenantLookup, id: string, tenantId: TenantId, transaction: Transaction, notFound: string): Promise<void> => {
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
const tenantInclude = <M>(model: M, as: string, attributes: string[], tenantId: TenantId): { model: M; as: string; attributes: string[]; required: false; where: { tenantId: TenantId } } => ({
  model,
  as,
  attributes,
  required: false,
  where: { tenantId },
});

/** The prior values of exactly the fields a PATCH is about to change. */
const pick = (record: object, fields: string[]): Record<string, unknown> =>
  fields.reduce<Record<string, unknown>>((out, field) => {
    const value = (record as Record<string, unknown>)[field];
    out[field] = value === undefined ? null : value;
    return out;
  }, {});

// ==========================================
// NON-CONFORMANCE
// ==========================================

/** An NC as the controller passes it (validated; a JavaScript caller may pass anything). */
interface NcInput {
  title?: string;
  description?: string;
  severity?: string | null;
  deviceId?: string | null;
  dateIdentified?: Date | string | null;
  rootCause?: string | null;
  status?: string;
  [field: string]: unknown;
}

/* eslint-disable @typescript-eslint/prefer-nullish-coalescing -- as built (ADR-038 rule 3): `||` treats "" and null as absent throughout the writers below */

/**
 * @param tenantId
 * @param reportedBy - the authenticated caller (req.user.id)
 * @param data - request body
 * @param actor - auditActor(req)
 * @returns the created NC
 */
const createNC = async (tenantId: TenantId, reportedBy: UserId, data: NcInput, actor: Actor = {}): Promise<NcRow> => {
  const { title, description, severity, deviceId, dateIdentified, rootCause } = data;

  return db.transaction(async (transaction) => {
    if (deviceId) {
      await assertInTenant(CalibrationDevice, deviceId, tenantId, transaction, "Device not found");
    }

    const ncNumber = await claimNumber("NC", tenantId, transaction);

    const ncValues: Record<string, unknown> = {
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
    };
    const nc = await NonConformance.create(ncValues as CreationAttributes<NcRow>, { transaction });

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

interface NcList {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  nonConformances: NcRow[];
}

const getNCs = async (tenantId: TenantId, page = 1, limit = 10, status?: string | null): Promise<NcList> => {
  const offset = (page - 1) * limit;
  const where: Record<string, unknown> = { tenantId };
  if (status) {where["status"] = status;}

  const { count, rows } = await NonConformance.findAndCountAll({
    where: where as WhereOptions,
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
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-conversion -- as built: a JavaScript caller passes the query string's page
    page: Number(page),
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-conversion -- as built: a JavaScript caller passes the query string's limit
    limit: Number(limit),
    totalPages: Math.ceil(count / limit),
    nonConformances: rows,
  };
};

/**
 * @param tenantId
 * @param ncId
 * @param data - validated PATCH body
 * @param actor - auditActor(req)
 * @returns the updated NC
 */
const updateNC = async (tenantId: TenantId, ncId: string, data: NcInput, actor: Actor = {}): Promise<NcRow> =>
  db.transaction(async (transaction) => {
    const nc = await NonConformance.findOne({ where: { id: ncId, tenantId }, transaction });
    if (!nc) {throw new AppError(404, "Non-Conformance not found");}

    const allowedUpdates = ["title", "description", "status", "severity", "rootCause"];
    const changed = allowedUpdates.filter((field) => data[field] !== undefined);
    const before = pick(nc, changed);
    changed.forEach((field) => {
      (nc as unknown as Record<string, unknown>)[field] = data[field];
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

/** A CAPA as the controller passes it (validated; a JavaScript caller may pass anything). */
interface CapaInput {
  ncId?: string;
  title?: string;
  actionPlan?: string;
  assignedTo?: string | null;
  dueDate?: Date | string | null;
  approvedBy?: unknown;
  status?: string;
  [field: string]: unknown;
}

/**
 * @param tenantId
 * @param data - request body
 * @param actor - auditActor(req)
 * @returns the created CAPA
 */
const createCapa = async (tenantId: TenantId, data: CapaInput, actor: Actor = {}): Promise<CapaRow> => {
  const { ncId, title, actionPlan, assignedTo, dueDate } = data;

  return db.transaction(async (transaction) => {
    const nc = await NonConformance.findOne({ where: { id: ncId as string, tenantId }, transaction });
    if (!nc) {throw new AppError(404, "Non-Conformance not found");}
    if (assignedTo) {
      await assertInTenant(User, assignedTo, tenantId, transaction, "Assignee not found");
    }

    const capaNumber = await claimNumber("CAPA", tenantId, transaction);

    const capaValues: Record<string, unknown> = {
      tenantId,
      capaNumber,
      ncId,
      title,
      actionPlan,
      assignedTo: assignedTo || null,
      dueDate: dueDate || null,
      status: "DRAFT",
    };
    const capa = await Capa.create(capaValues as CreationAttributes<CapaRow>, { transaction });

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
    // A-11: fires from afterCommit — never for a rolled-back create.
    webhookService.emitAfterCommit(transaction, tenantId, WEBHOOK_EVENTS.CAPA_CREATED, {
      capaId: capa.id, capaNumber, ncId, ncNumber: nc.ncNumber, status: "DRAFT", dueDate: dueDate || null,
    });

    return capa;
  });
};

interface CapaList {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  capas: CapaRow[];
}

const getCapas = async (tenantId: TenantId, page = 1, limit = 10, status?: string | null): Promise<CapaList> => {
  const offset = (page - 1) * limit;
  const where: Record<string, unknown> = { tenantId };
  if (status) {where["status"] = status;}

  const { count, rows } = await Capa.findAndCountAll({
    where: where as WhereOptions,
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
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-conversion -- as built: a JavaScript caller passes the query string's page
    page: Number(page),
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-conversion -- as built: a JavaScript caller passes the query string's limit
    limit: Number(limit),
    totalPages: Math.ceil(count / limit),
    capas: rows,
  };
};

/**
 * @param tenantId
 * @param capaId
 * @param data - validated PATCH body
 * @param actor - auditActor(req); `actor.userId` is the caller, and
 *   is who an approval records (A-62)
 * @returns the updated CAPA
 */
const updateCapa = async (tenantId: TenantId, capaId: string, data: CapaInput, actor: Actor = {}): Promise<CapaRow> =>
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
      if (data[field] !== undefined) {(capa as unknown as Record<string, unknown>)[field] = data[field];}
    });
    if (data.approvedBy !== undefined) {
      capa.approvedBy = (data.approvedBy === null ? null : actor.userId || null) as UserId | null;
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
    // A-11: the transition into CLOSED, announced from afterCommit.
    if (data.status === "CLOSED" && before["status"] !== "CLOSED") {
      webhookService.emitAfterCommit(transaction, tenantId, WEBHOOK_EVENTS.CAPA_CLOSED, {
        capaId: capa.id, capaNumber: capa.capaNumber, ncId: capa.ncId, status: capa.status, closedBy: actor.userId || null,
      });
    }

    return capa;
  });

/* eslint-enable @typescript-eslint/prefer-nullish-coalescing */

export = {
  createNC,
  getNCs,
  updateNC,
  createCapa,
  getCapas,
  updateCapa,
};
