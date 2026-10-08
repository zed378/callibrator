/**
 * P9-20 / P9-25 (ADR-103) — the contract of `calibrationRecords.route.ts`,
 * code-first. Every route carries `auth` and a `dynamicAccess` gate on the
 * `calibration` resource; the writes also refuse the platform tenant
 * (`denyPlatformAuthoring`, A-127), and a void refuses an API key (Q-51).
 * The query, params and bodies are the schemas the CONTROLLER validates
 * (`validators/calibrationRecords.validator` → `@callibrator/contracts/calibrationRecords`).
 * A record is append-only (P6-03, migration 0057): there is no update and no
 * delete; a correction is a new, superseding record and a void is final.
 * Examples are synthetic.
 */
import { z } from "zod";
import {
  calibrationRecordIdSchema,
  correctCalibrationRecordSchema,
  createCalibrationRecordSchema,
  getCalibrationRecordsQuery,
  voidCalibrationRecordSchema,
} from "../../validators/calibrationRecords.validator";
import { defineRouteDocs } from "../../docs/openapi/operation";

const timestamp = z.iso.datetime();

/** A calibration record as the API answers it (the model row as JSON, with its joins on reads). */
const CalibrationRecord = z
  .object({
    id: z.guid(),
    tenantId: z.guid(),
    deviceId: z.guid(),
    performedBy: z.guid().nullable(),
    apiKeyId: z.guid().nullable(),
    calibrationDate: timestamp,
    dueDate: timestamp.nullable(),
    standard: z.string().nullable(),
    results: z.record(z.string(), z.unknown()).nullable(),
    measurementUncertainty: z.number().nullable(),
    isCompliant: z.boolean().nullable(),
    certificateNumber: z.string().nullable(),
    certificateFileUrl: z.string().nullable(),
    notes: z.string().nullable(),
    isDeleted: z.boolean(),
    supersedesId: z.guid().nullable(),
    correctionReason: z.string().nullable(),
    supersededById: z.guid().nullable(),
    supersededAt: timestamp.nullable(),
    voidReason: z.string().nullable(),
    voidedBy: z.guid().nullable(),
    createdAt: timestamp,
    updatedAt: timestamp,
    // P9-25 item 11: the include's attributes (calibrationRecords.service), named.
    device: z
      .object({
        id: z.guid(),
        name: z.string(),
        serialNumber: z.string().nullable(),
        manufacturer: z.string().nullable(),
        model: z.string().nullable(),
      })
      .nullable()
      .optional(),
    performer: z.object({ id: z.guid(), firstName: z.string(), lastName: z.string() }).loose().nullable().optional(),
    apiKey: z.object({ id: z.guid(), name: z.string(), keyPrefix: z.string() }).nullable().optional(),
  })
  .meta({
    id: "CalibrationRecord",
    description:
      "An ISO 17025 §7.5 technical record. Append-only: a correction supersedes it (supersededById) and a void hides it with its reason.",
    example: {
      id: "6a7b8c9d-0e1f-4a2b-8c3d-4e5f6a7b8c9d",
      tenantId: "0b7e6d5c-4a3b-4c2d-8e1f-9a8b7c6d5e4f",
      deviceId: "1d2c3b4a-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
      performedBy: "7c8d9e0f-1a2b-4c3d-9e4f-5a6b7c8d9e0f",
      apiKeyId: null,
      calibrationDate: "2030-01-15T00:00:00.000Z",
      dueDate: "2031-01-15T00:00:00.000Z",
      standard: "ISO 17025",
      results: { reading: 37.1, unit: "C" },
      measurementUncertainty: 0.1,
      isCompliant: true,
      certificateNumber: null,
      certificateFileUrl: null,
      notes: "Within tolerance",
      isDeleted: false,
      supersedesId: null,
      correctionReason: null,
      supersededById: null,
      supersededAt: null,
      voidReason: null,
      voidedBy: null,
      createdAt: "2030-01-15T09:00:00.000Z",
      updatedAt: "2030-01-15T09:00:00.000Z",
    },
  });

/** `:calibrationRecordId`, the validator's own field (`.meta()` clones it) with a synthetic example. */
const recordIdParams = z.object({
  calibrationRecordId: calibrationRecordIdSchema.shape.calibrationRecordId.meta({
    description: "The calibration record's id",
    example: "6a7b8c9d-0e1f-4a2b-8c3d-4e5f6a7b8c9d",
  }),
});

const read = { kind: "dynamicAccess", resource: "calibration", action: "read" } as const;
const write = { kind: "dynamicAccess", resource: "calibration", action: "write" } as const;
/** Void: `rbac([TENANT_ADMIN])` first, then the `calibration` write gate (P20-06, spec P18-01-02 § 4.3). */
const tenantAdmin = { kind: "rbac", roles: ["TENANT_ADMIN"] } as const;
const PLATFORM = "The platform tenant authors nothing here (403, A-127).";

export default defineRouteDocs({
  router: "api/calibrationRecords.route",
  mount: "/api/v1/calibration-records",
  tag: "CalibrationRecords",
  tenantScoped: true,
  operations: [
    {
      method: "get",
      path: "/",
      operationId: "listCalibrationRecords",
      summary: "List calibration records",
      description:
        "Newest calibration first. The list shows the record in force: a record a correction superseded is left out unless includeSuperseded=true; a voided record is never listed.",
      permission: read,
      audited: false,
      query: getCalibrationRecordsQuery,
      success: { status: 200, description: "A page of records; pagination in the top-level `meta`", list: CalibrationRecord },
    },
    {
      method: "post",
      path: "/",
      operationId: "createCalibrationRecord",
      summary: "Record a calibration",
      description:
        `The device must be the caller's tenant's (else 404). The record names who performed it from the principal, never the body (Q-51), and moves the device's next calibration date by its interval, in the same transaction. ${PLATFORM}`,
      permission: write,
      audited: true,
      body: createCalibrationRecordSchema,
      success: { status: 201, description: "The new record", data: CalibrationRecord },
    },
    {
      method: "get",
      path: "/:calibrationRecordId",
      operationId: "getCalibrationRecord",
      summary: "Get one calibration record",
      permission: read,
      audited: false,
      params: recordIdParams,
      success: { status: 200, description: "The record, with its device and performer", data: CalibrationRecord },
    },
    {
      method: "post",
      path: "/:calibrationRecordId/corrections",
      operationId: "correctCalibrationRecord",
      summary: "Correct a calibration record (writes a superseding record)",
      description:
        "The original is never changed: a NEW record is written with the corrected content (omitted fields are carried over), " +
        `supersedesId set to the original and the reason recorded; the original is marked superseded. ${PLATFORM}`,
      permission: write,
      audited: true,
      params: recordIdParams,
      body: correctCalibrationRecordSchema,
      conflict: "The record was voided, or a correction already superseded it (correct the latest correction instead).",
      success: { status: 201, description: "The superseding record", data: CalibrationRecord },
    },
    {
      method: "post",
      path: "/:calibrationRecordId/void",
      operationId: "voidCalibrationRecord",
      summary: "Void a calibration record entered in error",
      description:
        `The record is kept, hidden from ordinary reads, with the reason and who voided it. A void is final. Tenant administrators only (rbac), who also need \`calibration\` write (dynamicAccess); a technician corrects instead (P20-06). An API key is refused (403): a person answers for a void (Q-51). ${PLATFORM}`,
      permission: tenantAdmin,
      audited: true,
      params: recordIdParams,
      body: voidCalibrationRecordSchema,
      conflict: "The record was already voided, or a correction has superseded it.",
      success: { status: 200, description: "Voided; the record is kept (no body in `data`)", empty: true },
    },
  ],
});
