/**
 * Calibration Record service methods
 *
 * P9-14 (ADR-087, Stage C): converted from calibrationRecords.service.js with no
 * behaviour change. `export =` keeps the exact object `require()` returned (the
 * same keys, in the same order). No method calls a sibling. `Op`,
 * `Transaction`, the three models, `logger`, `AppError`, `DEFAULT_LIMIT`,
 * `auditService`, the three audit helpers, `db` and `validateInput` are
 * captured once at load, in the `.js`'s require order. The validator module is
 * still required inside each writing method, at call time, as the `.js` did.
 */
import { Op as LoadedOp, Transaction as LoadedTransaction, type CreationAttributes, type WhereOptions } from "sequelize";
import models from "../models";
import { logger as loadedLogger } from "../middlewares/activityLog.middleware";
// The `.js` destructured AppError and never used it: the module load is kept.
import "../utils/appError.util";
import { DEFAULT_LIMIT as LOADED_DEFAULT_LIMIT } from "../constants";
import loadedAuditService from "./audit.service";
import {
  auditEntryActor as loadedAuditEntryActor,
  actorChanges as loadedActorChanges,
  rowActor as loadedRowActor,
  type AuditActorInput,
} from "../utils/auditPrincipal.util";
import { db as loadedDb } from "../config";
import { validateInput } from "../validators/input";
import type * as CalibrationRecordsValidator from "../validators/calibrationRecords.validator";
import type { AuditAction } from "../constants/auditActions";
import type { TenantId, UserId } from "../types/ids";
import type * as CalibrationDatesService from "./calibrationDates.service";
import type { ModelInstance } from "../types/models";

// P21-05 (ADR-133 § 1, G-11): the next due date is re-derived from the latest effective record.
// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded at call time: calibrationDates.service loads the models barrel this module's callers mock
const calibrationDates = (): typeof CalibrationDatesService => require("./calibrationDates.service") as typeof CalibrationDatesService;

const Op = LoadedOp;
const Transaction = LoadedTransaction;
const { CalibrationRecord, CalibrationDevice, ApiKey } = models;

type RecordRow = ModelInstance<"CalibrationRecord">;
type SqlTransaction = InstanceType<typeof LoadedTransaction>;

/**
 * Q-51 (ADR-100 Amendment 2) — the key that wrote a row, for lists and
 * details: its id, name and display prefix ONLY (never the hash). LEFT JOIN
 * (`required: false`): ApiKey's defaultScope carries a `where`, so a bare
 * include would drop every user-written record. `includeDeleted`: a revoked
 * (soft-deleted) key still names the rows it wrote. The tenant hooks scope
 * the join (ADR-048).
 *
 * @returns a fresh include (Sequelize annotates includes in place)
 */
const apiKeyActorInclude = (): { model: ReturnType<typeof ApiKey.scope>; as: string; attributes: string[]; required: false } => ({
  model: ApiKey.scope("includeDeleted"),
  as: "apiKey",
  attributes: ["id", "name", "keyPrefix"],
  required: false,
});
const logger = loadedLogger;
const DEFAULT_LIMIT = LOADED_DEFAULT_LIMIT;
const auditService = loadedAuditService;
const auditEntryActor = loadedAuditEntryActor;
const actorChanges = loadedActorChanges;
const rowActor = loadedRowActor;
const db = loadedDb;

/**
 * A-41 — a calibration record is an ISO 17025 §7.5 technical record. Every
 * create/update/delete writes its audit row inside the SAME transaction as the
 * change (MEMORY/specs/A-41-audit-inside-transaction.md, rows 8-10): a
 * rollback takes the row with it, and a failed audit insert (re-thrown by
 * logAction) rolls the change back.
 */
const auditRecord = (
  transaction: SqlTransaction,
  tenantId: TenantId,
  recordId: string,
  action: AuditAction,
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  actor: AuditActorInput,
): Promise<unknown> =>
  auditService.logAction(
    {
      tenantId,
      // A-282 (ADR-100): a key is system:api-key, its id in changes.
      ...auditEntryActor(actor),
      action,
      resourceType: "CalibrationRecord",
      resourceId: recordId,
      changes: { before, after, ...actorChanges(actor) },
    },
    { transaction },
  );

// ==========================================
// VALIDATION HELPERS
// ==========================================

const validate = validateInput;

/** The validator module, required at call time as the `.js` did. */
// eslint-disable-next-line @typescript-eslint/no-require-imports -- as built: required inside each writing method (see the file header)
const recordSchemas = (): typeof CalibrationRecordsValidator => require("../validators/calibrationRecords.validator") as typeof CalibrationRecordsValidator;

/** A service answer the controller forwards. */
interface Outcome<T> {
  success: boolean;
  status: number;
  message: string;
  data: T;
}

// ==========================================
// SERVICE METHODS
// ==========================================

/** The list query as the controller passes it (validated; a JavaScript caller may pass anything). */
interface RecordListQuery {
  tenantId: TenantId;
  page?: number | string | undefined;
  limit?: number | string | undefined;
  deviceId?: string | null | undefined;
  isCompliant?: boolean | null | undefined;
  from?: string | Date | null | undefined;
  to?: string | Date | null | undefined;
  includeSuperseded?: boolean | undefined;
}

interface RecordListData {
  rows: RecordRow[];
  count: number;
  meta: { total: number; page: number; limit: number; totalPages: number };
}

/** A caught value's `message`, read exactly as the `.js` read it (a thrown `null` still throws here). */
const messageOf = (error: unknown): unknown => (error as { message?: unknown }).message;

/**
 * Fetch all calibration records for a tenant with pagination and filtering
 */
const fetchCalibrationRecords = async ({
  tenantId,
  page = 1,
  limit = DEFAULT_LIMIT,
  deviceId,
  isCompliant,
  from,
  to,
  includeSuperseded = false,
}: RecordListQuery): Promise<Outcome<RecordListData>> => {
  try {
    const whereClause: Record<string, unknown> = { tenantId };

    // P6-03: a corrected record stays, but the list shows the record in force
    // — the latest correction — unless the caller asks for the history too.
    if (!includeSuperseded) {
      whereClause["supersededById"] = null;
    }

    if (deviceId) {
      whereClause["deviceId"] = deviceId;
    }

    if (isCompliant !== null && isCompliant !== undefined) {
      whereClause["isCompliant"] = isCompliant;
    }

    if (from || to) {
      const range: Record<symbol, unknown> = {};
      whereClause["calibrationDate"] = range;
      if (from) {range[Op.gte] = from;}
      if (to) {range[Op.lte] = to;}
    }

    // U-06 (ADR-119): the count and the page are two statements, as
    // findAndCountAll issued them, with two differences.
    //  - The count reads the records alone. Every include below is a to-one
    //    LEFT JOIN, which can neither add a record nor drop one, so it cannot
    //    change the total; without them the count is an index-only scan of
    //    0109's live-records index instead of a heap visit per record.
    //  - The page is selected first and joined after (`subQuery: true`): the
    //    LIMIT/OFFSET runs inside a subquery over the records, and only the
    //    page's rows are joined. Before, page 200 joined 2,000 rows to their
    //    device and performer and threw 1,990 away (6,592 buffers; 600 after).
    const countWhere: WhereOptions = { ...whereClause };
    const pageWhere: WhereOptions = { ...whereClause };
    const [count, found] = await Promise.all([
      CalibrationRecord.count({ where: countWhere }),
      CalibrationRecord.findAll({
        where: pageWhere,
        order: [["calibrationDate", "DESC"], ["id", "DESC"]],
        limit: Number(limit),
        offset: (Number(page) - 1) * Number(limit),
        subQuery: true,
        include: [
          // LEFT JOINs (A-90): User and CalibrationDevice have a defaultScope
          // `where`, so an include without `required: false` is an INNER JOIN
          // that drops the RECORD when its device is soft-deleted or its
          // performer is deleted or outside the tenant (the super admin acting
          // inside a tenant). The relation reads as null instead.
          {
            association: "device",
            attributes: ["id", "name", "serialNumber", "manufacturer", "model"],
            required: false,
          },
          {
            association: "performer",
            attributes: ["id", "firstName", "lastName"],
            required: false,
          },
          apiKeyActorInclude(),
        ],
      }),
    ]);
    // findAndCountAll's rule, kept: no total, no rows.
    const rows = count === 0 ? [] : found;

    return {
      success: true,
      status: 200,
      message: "Fetch calibration records successful",
      data: {
        rows,
        count,
        meta: {
          total: count,
          page: Number(page),
          limit: Number(limit),
          totalPages: Math.ceil(count / Number(limit)),
        },
      },
    };
  } catch (error) {
    logger.error("Error fetching calibration records", {
      error: messageOf(error),
    });
    throw error;
  }
};

/**
 * Fetch a specific calibration record by ID
 */
const fetchSpecificCalibrationRecord = async (
  tenantId: TenantId,
  calibrationRecordId: string,
): Promise<Outcome<RecordRow | null>> => {
  try {
    const record = await CalibrationRecord.findOne({
      where: { id: calibrationRecordId, tenantId },
      include: [
        {
          association: "device",
          attributes: [
            "id",
            "name",
            "serialNumber",
            "manufacturer",
            "model",
            "category",
          ],
          required: false, // A-90: a record outlives its device's soft delete
        },
        {
          association: "performer",
          attributes: ["id", "firstName", "lastName", "email"],
          required: false, // A-90: nor does a missing performer hide the record
        },
        apiKeyActorInclude(),
      ],
    });

    if (!record) {
      return {
        success: false,
        status: 404,
        message: "Calibration record not found",
        data: null,
      };
    }

    return {
      success: true,
      status: 200,
      message: "Fetch calibration record successful",
      data: record,
    };
  } catch (error) {
    logger.error("Error fetching specific calibration record", {
      error: messageOf(error),
      calibrationRecordId,
    });
    throw error;
  }
};

/**
 * Create a new calibration record
 */
const createCalibrationRecord = async (
  tenantId: TenantId,
  userId: UserId | null,
  inputData: unknown,
  actor: AuditActorInput = {},
): Promise<Outcome<RecordRow | null>> => {
  try {
    const validated = validate(
      inputData,
      recordSchemas()
        .createCalibrationRecordSchema,
    );

    // Verify device belongs to tenant
    const device = await CalibrationDevice.findOne({
      where: { id: validated.deviceId, tenantId },
    });

    if (!device) {
      return {
        success: false,
        status: 404,
        message: "Device not found or not belonging to this tenant",
        data: null,
      };
    }

    const record = await db.transaction(async (transaction) => {
      const values: Record<string, unknown> = {
        ...validated,
        tenantId,
        // Q-51: from the principal (auditPrincipal), never the body — a key
        // in apiKeyId with performedBy null, a user in performedBy.
        performedBy: rowActor(actor, userId).userId,
        apiKeyId: rowActor(actor, userId).apiKeyId,
      };
      // P21-05 (ADR-133 § 3): the performer as recorded at insert (a person; a key records none).
      const performer = rowActor(actor, userId).userId;
      values["performerSnapshot"] = performer ? await calibrationDates().performerSnapshotFor(performer) : null;
      const created = await CalibrationRecord.create(values as CreationAttributes<RecordRow>, { transaction });

      // P21-05 (ADR-133 § 1, G-11): the device's next due date from its latest EFFECTIVE record,
      // in the same transaction, so it never moves for a record that did not commit — and an
      // older record entered today no longer moves it backward.
      await calibrationDates().rederiveNextCalibrationDate(tenantId, device.id, { recordId: created.id, newRecord: true }, { ...actor, userId }, transaction);

      await auditRecord(transaction, tenantId, created.id, "CREATE", {}, validated, {
        ...actor,
        userId,
      });
      return created;
    });

    return {
      success: true,
      status: 201,
      message: "Calibration record created successfully",
      data: record,
    };
  } catch (error) {
    logger.error("Error creating calibration record", {
      error: messageOf(error),
    });
    throw error;
  }
};

// ==========================================
// P6-03 — APPEND-ONLY: CORRECT AND VOID
// ==========================================
//
// A calibration record's content never changes after it is written (BR-7,
// 21 CFR 11.10(e)): the database trigger from migration 0057 refuses it for
// every role, and the application role has no UPDATE/DELETE on the table
// except the lifecycle columns. The two operations that replace PUT and
// DELETE therefore only ever INSERT a row or set a lifecycle column once:
//
//   correct — a NEW row carrying the corrected content, `supersedesId` and a
//             reason; the original gains `supersededById`/`supersededAt`.
//             Both rows stay, and the audit trail shows both.
//   void    — `isDeleted`, `voidReason`, `voidedBy` set once.
//             Final: there is no restore.

/** The content columns a correction may carry; everything else is lifecycle. */
const CONTENT_FIELDS = Object.freeze([
  "deviceId",
  "calibrationDate",
  "dueDate",
  "standard",
  "results",
  "measurementUncertainty",
  "isCompliant",
  "certificateNumber",
  "certificateFileUrl",
  "notes",
]);

/**
 * The record `id` in the caller's tenant, locked for the transaction, INCLUDING
 * a voided one (so a void can be explained as a 409 rather than reported as
 * missing). Another tenant's record is not found: 404, never 403.
 */
const lockRecord = (tenantId: TenantId, calibrationRecordId: string, transaction: SqlTransaction): Promise<RecordRow | null> =>
  CalibrationRecord.unscoped().findOne({
    where: { id: calibrationRecordId, tenantId },
    paranoid: false,
    transaction,
    lock: Transaction.LOCK.UPDATE,
  });

const notFound = (): Outcome<null> => ({
  success: false,
  status: 404,
  message: "Calibration record not found",
  data: null,
});

/**
 * @param record - a locked calibration record
 * @param operation
 * @returns the 409 explaining why `operation` is refused, or null
 */
const lifecycleConflict = (record: RecordRow, operation: "correct" | "void"): Outcome<null> | null => {
  if (record.isDeleted) {
    return {
      success: false,
      status: 409,
      message:
        `This calibration record was voided${record.voidReason ? ` ("${record.voidReason}")` : ""} and ` +
        `cannot be ${operation === "correct" ? "corrected" : "voided again"}: a void is final.`,
      data: null,
    };
  }
  if (record.supersededById) {
    return {
      success: false,
      status: 409,
      message:
        `This calibration record was already corrected by record ${record.supersededById}. ` +
        `${operation === "correct" ? "Correct" : "Void"} the latest correction instead — a record is ` +
        "superseded at most once, so the correction history stays a single line.",
      data: null,
    };
  }
  return null;
};

/** The facts a record took at insert that its correction carries (P21-05; only those it holds). */
const INSERT_FACTS = Object.freeze(["entryKind", "calibrationVendorId", "externalLabName", "roomSnapshot", "floorSnapshot", "performerSnapshot"] as const);
const insertFacts = (original: RecordRow): Record<string, unknown> =>
  Object.fromEntries(
    INSERT_FACTS.map((key): [string, unknown] => [key, (original as unknown as Record<string, unknown>)[key]]).filter(([, value]) => value !== null && value !== undefined),
  );

/**
 * Correct a calibration record: write a new record that supersedes it.
 *
 * @param tenantId
 * @param userId - who is writing the correction (audit actor)
 * @param calibrationRecordId - the record being corrected
 * @param inputData - corrected content fields plus a required `reason`
 * @param actor - ipAddress / userAgent for the audit rows
 * @returns service result: 201 with the NEW record, 404, or 409
 */
const correctCalibrationRecord = async (
  tenantId: TenantId,
  userId: UserId | null,
  calibrationRecordId: string,
  inputData: unknown,
  actor: AuditActorInput = {},
): Promise<Outcome<RecordRow | null>> => {
  try {
    const { reason, ...changes } = validate(
      inputData,
      recordSchemas()
        .correctCalibrationRecordSchema,
    );

    if (changes.deviceId) {
      const device = await CalibrationDevice.findOne({
        where: { id: changes.deviceId, tenantId },
      });
      if (!device) {
        return {
          success: false,
          status: 404,
          message: "Device not found or not belonging to this tenant",
          data: null,
        };
      }
    }

    const outcome = await db.transaction(async (transaction): Promise<Outcome<RecordRow | null>> => {
      const original = await lockRecord(tenantId, calibrationRecordId, transaction);
      if (!original) {
        return notFound();
      }
      const conflict = lifecycleConflict(original, "correct");
      if (conflict) {
        return conflict;
      }

      const changed = changes as Record<string, unknown>;
      const content = Object.fromEntries(
        CONTENT_FIELDS.map((field) => [
          field,
          Object.hasOwn(changed, field) ? changed[field] : (original as unknown as Record<string, unknown>)[field],
        ]),
      );
      // P21-05 (ADR-133 § 2): an outside laboratory's date carries no results (CHECK
      // calibration_records_external_no_results) — its correction cannot add them.
      if (original.entryKind === "external_date" && ["standard", "results", "measurementUncertainty"].some((k) => changed[k] !== undefined && changed[k] !== null && changed[k] !== "")) {
        return {
          success: false,
          status: 400,
          message: "This record is an outside laboratory's calibration date; it carries no standard, results or uncertainty. Record a full calibration instead.",
          data: null,
        };
      }
      const correctionValues: Record<string, unknown> = {
        ...content,
        // P21-05: what the original recorded at insert stays the correction's: its kind, laboratory,
        // room and performer (the person who performed it does not change with a correction).
        ...insertFacts(original),
        tenantId,
        // Who PERFORMED the calibration does not change because someone
        // corrected its record; who corrected it is the audit row's actor.
        performedBy: original.performedBy,
        // Q-51: a key-recorded original stays key-recorded (`?? null`: a row read
        // before the column existed may carry undefined — kept as built).
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- the assertion admits the undefined the `.js` guarded against
        apiKeyId: (original.apiKeyId as string | null | undefined) ?? null,
        supersedesId: original.id,
        correctionReason: reason,
      };
      const correction = await CalibrationRecord.create(correctionValues as CreationAttributes<RecordRow>, { transaction });
      const supersededAt = new Date();
      await original.update(
        { supersededById: correction.id, supersededAt },
        { transaction },
      );

      const actorWithUser = { ...actor, userId };
      await auditRecord(transaction, tenantId, correction.id, "CREATE", {}, {
        ...content,
        supersedesId: original.id,
        correctionReason: reason,
      }, actorWithUser);
      await auditRecord(
        transaction,
        tenantId,
        original.id,
        "UPDATE",
        { supersededById: null },
        { supersededById: correction.id, supersededAt, correctionReason: reason, changed: Object.keys(changes) },
        actorWithUser,
      );
      // P21-05 (G-11): the date follows the correction — on the original's device and, when the
      // correction names another device, on that one too.
      for (const deviceId of new Set([original.deviceId, correction.deviceId])) {
        await calibrationDates().rederiveNextCalibrationDate(tenantId, deviceId, { recordId: correction.id, newRecord: deviceId === correction.deviceId }, actorWithUser, transaction);
      }

      return {
        success: true,
        status: 201,
        message: "Calibration record corrected: a superseding record was written and the original kept",
        data: correction,
      };
    });

    return outcome;
  } catch (error) {
    logger.error("Error correcting calibration record", {
      error: messageOf(error),
    });
    throw error;
  }
};

/**
 * Void a calibration record entered in error. Final — there is no restore.
 *
 * @param tenantId
 * @param userId - who voids it
 * @param calibrationRecordId
 * @param inputData - `{ reason }`, required
 * @param actor - ipAddress / userAgent for the audit row
 * @returns service result: 200, 404, or 409
 */
const voidCalibrationRecord = async (
  tenantId: TenantId,
  userId: UserId | null,
  calibrationRecordId: string,
  inputData: unknown,
  actor: AuditActorInput = {},
): Promise<Outcome<null>> => {
  try {
    const { reason } = validate(
      inputData,
      recordSchemas()
        .voidCalibrationRecordSchema,
    );

    return await db.transaction(async (transaction): Promise<Outcome<null>> => {
      const record = await lockRecord(tenantId, calibrationRecordId, transaction);
      if (!record) {
        return notFound();
      }
      const conflict = lifecycleConflict(record, "void");
      if (conflict) {
        return conflict;
      }

      // `deletedAt` is not written: Sequelize treats the paranoid timestamp as
      // read-only on update and would drop it silently. `isDeleted` is what
      // every read filters on (the defaultScope), as it was for soft deletes.
      const voided = { isDeleted: true, voidReason: reason, voidedBy: userId };
      await record.update(voided, { transaction });
      await auditRecord(
        transaction,
        tenantId,
        record.id,
        "DELETE",
        { isDeleted: false },
        voided,
        { ...actor, userId },
      );
      // P21-05 (G-11): voiding the record that set the date falls back to the previous one.
      await calibrationDates().rederiveNextCalibrationDate(tenantId, record.deviceId, { recordId: record.id, newRecord: false }, { ...actor, userId }, transaction);

      return {
        success: true,
        status: 200,
        message: "Calibration record voided. The record is kept; a void is final.",
        data: null,
      };
    });
  } catch (error) {
    logger.error("Error voiding calibration record", {
      error: messageOf(error),
    });
    throw error;
  }
};

export = {
  fetchCalibrationRecords,
  fetchSpecificCalibrationRecord,
  createCalibrationRecord,
  correctCalibrationRecord,
  voidCalibrationRecord,
};
