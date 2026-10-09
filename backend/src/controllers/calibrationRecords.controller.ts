/**
 * Calibration Record controller, `/api/v1/calibration-records`.
 *
 * P9-20 (ADR-087): converted from calibrationRecords.controller.js, behaviour
 * unchanged. `req.user`, `req.query`, `req.params` and `req.body` are read
 * INLINE as the JavaScript read them (a missing user throws the same TypeError,
 * inside the wrapper). Everything the JavaScript required at load (the service
 * module, `asyncHandler`, `sendResult`, `auditPrincipal`, the five schemas and
 * `validateInput`) is captured at load, in its order. `export =` keeps the
 * exact object `require()` returned (the same keys, in the same order).
 */
import type { Request, Response } from "express";
import calibrationRecordsService from "../services/calibrationRecords.service";
import { asyncHandler as loadedAsyncHandler } from "../utils/controllerWrapper.util";
// A-112: sendResult, not success() — calibrationRecords.service RETURNS its
// not-found outcomes, and success() sent them with `success: true`.
import { sendResult as loadedSendResult } from "../utils/response.util";
// Who did it, from where — for the audit row the service writes inside its
// transaction (A-41).
// A-282 (ADR-100): an API key (calibration:write) is audited as system:api-key.
import { auditPrincipal as loadedAuditPrincipal } from "../utils/auditPrincipal.util";
import {
  getCalibrationRecordsQuery as loadedListQuery,
  calibrationRecordIdSchema as loadedIdSchema,
  createCalibrationRecordSchema as loadedCreateSchema,
  correctCalibrationRecordSchema as loadedCorrectSchema,
  voidCalibrationRecordSchema as loadedVoidSchema,
} from "../validators/calibrationRecords.validator";
import { validateInput } from "../validators/input";
import type { TenantId, UserId } from "../types/ids";
import { withDisplay, withDisplays } from "../services/personDisplay.service";
import { recapFacts } from "../services/calibrationRecap.service";

/** P21-09e (spec § 12): the performer shown beside each record, for every viewer. */
const RECORD_PEOPLE = { performerDisplay: "performedBy" } as const;

const asyncHandler = loadedAsyncHandler;
const sendResult = loadedSendResult;
const auditPrincipal = loadedAuditPrincipal;
const getCalibrationRecordsQuery = loadedListQuery;
const calibrationRecordIdSchema = loadedIdSchema;
const createCalibrationRecordSchema = loadedCreateSchema;
const correctCalibrationRecordSchema = loadedCorrectSchema;
const voidCalibrationRecordSchema = loadedVoidSchema;
const validate = validateInput;

/** The principal `auth` set (read without a guard, as before). */
interface RecordPrincipal {
  tenantId: TenantId;
  id: UserId;
}
const userOf = (req: Request): RecordPrincipal => req.user as RecordPrincipal;

const getAllCalibrationRecords = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = userOf(req).tenantId;
  const validated = validate(req.query, getCalibrationRecordsQuery);
  const result = await calibrationRecordsService.fetchCalibrationRecords({
    tenantId,
    page: validated.page,
    limit: validated.limit,
    deviceId: validated.deviceId,
    isCompliant: validated.isCompliant,
    from: validated.from,
    to: validated.to,
    includeSuperseded: validated.includeSuperseded,
    // P21-06 (spec P19-05 § 8): the recap reads.
    dateField: validated.dateField,
    fromDay: validated.fromDay,
    toDay: validated.toDay,
    latestOnly: validated.latestOnly,
    entryKind: validated.entryKind,
    clientFacilityId: validated.clientFacilityId,
    qrCode: validated.qrCode,
    sort: validated.sort,
  });

  // Rows in `data`, pagination in a top-level `meta`. A failed result carries
  // no rows; sendResult sends it down the error path and ignores the meta.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- as built: a failed result has no page (ADR-038 rule 3)
  const page: Partial<typeof result.data> = result.data || {};
  // P21-06: each row's recap facts (the room snapshot, `effective`, the facility for provider staff).
  const rows = page.rows ? await recapFacts(await withDisplays(page.rows, RECORD_PEOPLE)) : page.rows;
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- as built (ADR-038 rule 3)
  sendResult(res, { ...result, data: rows }, page.meta || null);
});

const getSpecificCalibrationRecord = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = userOf(req).tenantId;
  const { calibrationRecordId } = validate(
    req.params,
    calibrationRecordIdSchema,
  );
  const result = await calibrationRecordsService.fetchSpecificCalibrationRecord(
    tenantId,
    calibrationRecordId,
  );

  sendResult(res, result.data ? { ...result, data: await withDisplay(result.data, RECORD_PEOPLE) } : result);
});

const createCalibrationRecord = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = userOf(req).tenantId;
  const userId = userOf(req).id;
  const validated = validate(req.body, createCalibrationRecordSchema);
  const result = await calibrationRecordsService.createCalibrationRecord(
    tenantId,
    userId,
    validated,
    auditPrincipal(req),
  );

  sendResult(res, result);
});

// P6-03 — no update, no delete: a correction is a new, superseding record and
// a void is final. Both need a reason; the service writes the audit rows.

const correctCalibrationRecord = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = userOf(req).tenantId;
  const { calibrationRecordId } = validate(
    req.params,
    calibrationRecordIdSchema,
  );
  const validated = validate(req.body, correctCalibrationRecordSchema);
  const result = await calibrationRecordsService.correctCalibrationRecord(
    tenantId,
    userOf(req).id,
    calibrationRecordId,
    validated,
    auditPrincipal(req),
  );

  sendResult(res, result);
});

const voidCalibrationRecord = asyncHandler(async (req: Request, res: Response) => {
  const tenantId = userOf(req).tenantId;
  const { calibrationRecordId } = validate(
    req.params,
    calibrationRecordIdSchema,
  );
  const validated = validate(req.body, voidCalibrationRecordSchema);
  const result = await calibrationRecordsService.voidCalibrationRecord(
    tenantId,
    userOf(req).id,
    calibrationRecordId,
    validated,
    auditPrincipal(req),
  );

  sendResult(res, result);
});

export = {
  getAllCalibrationRecords,
  getSpecificCalibrationRecord,
  createCalibrationRecord,
  correctCalibrationRecord,
  voidCalibrationRecord,
};
